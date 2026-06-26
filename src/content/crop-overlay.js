// Crop-overlay content script (injected on toolbar click).
//
// Mimics macOS Cmd+Shift+4: dims the viewport, shows a crosshair, and lets the
// user drag a selection box. On mouse-up it asks the background worker to
// capture the visible tab, crops the capture to the selection (accounting for
// devicePixelRatio), copies the cropped PNG to the clipboard, and logs the
// item to history before opening Google Lens.
//
// Esc cancels at any time.

(() => {
  // Guard against double-injection if the user clicks the action twice.
  if (window.__flipLensOverlayActive) return;
  window.__flipLensOverlayActive = true;

  const dpr = window.devicePixelRatio || 1;

  const overlay = document.createElement("div");
  overlay.id = "__fliplens_overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(0,0,0,0.28)",
    userSelect: "none",
  });

  const selection = document.createElement("div");
  Object.assign(selection.style, {
    position: "fixed",
    border: "2px solid #4f9dff",
    background: "rgba(79,157,255,0.12)",
    boxShadow: "0 0 0 100000px rgba(0,0,0,0.28)",
    display: "none",
    pointerEvents: "none",
    zIndex: "2147483647",
  });

  const hint = document.createElement("div");
  hint.textContent = "Drag to select an item — Esc to cancel";
  Object.assign(hint.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 14px",
    background: "rgba(20,20,20,0.92)",
    color: "#fff",
    font: "13px/1.4 system-ui, sans-serif",
    borderRadius: "8px",
    zIndex: "2147483647",
    pointerEvents: "none",
  });

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(selection);
  document.documentElement.appendChild(hint);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function cleanup() {
    overlay.remove();
    selection.remove();
    hint.remove();
    document.removeEventListener("keydown", onKey, true);
    window.__flipLensOverlayActive = false;
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  }
  document.addEventListener("keydown", onKey, true);

  overlay.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.display = "block";
    updateSelection(e.clientX, e.clientY);
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    updateSelection(e.clientX, e.clientY);
  });

  overlay.addEventListener("mouseup", async (e) => {
    if (!dragging) return;
    dragging = false;
    const rect = rectFrom(startX, startY, e.clientX, e.clientY);
    // Ignore accidental clicks / tiny selections.
    if (rect.width < 5 || rect.height < 5) {
      cleanup();
      return;
    }
    // Hide overlay chrome before capture so it isn't included in the screenshot.
    overlay.style.display = "none";
    selection.style.display = "none";
    hint.style.display = "none";
    await captureAndProcess(rect);
    cleanup();
  });

  function updateSelection(curX, curY) {
    const r = rectFrom(startX, startY, curX, curY);
    selection.style.left = r.left + "px";
    selection.style.top = r.top + "px";
    selection.style.width = r.width + "px";
    selection.style.height = r.height + "px";
  }

  function rectFrom(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    return {
      left,
      top,
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  async function captureAndProcess(rect) {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: "FLIPLENS_CAPTURE" });
    } catch (e) {
      toast("Capture failed: " + e);
      return;
    }
    if (!resp || !resp.ok) {
      toast("Capture failed" + (resp && resp.error ? ": " + resp.error : ""));
      return;
    }

    let cropped;
    try {
      cropped = await cropDataUrl(resp.dataUrl, rect, dpr);
    } catch (e) {
      toast("Could not crop image: " + e);
      return;
    }

    // Copy the cropped image to the clipboard so the user can paste into Lens.
    let copied = false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": cropped.blob }),
      ]);
      copied = true;
    } catch (e) {
      // Clipboard may be blocked on some pages; the flow still works manually.
      console.warn("Flip Lens: clipboard write failed:", e);
    }

    // Log the entry + open Lens via background.
    try {
      await chrome.runtime.sendMessage({
        type: "FLIPLENS_LOG_ENTRY",
        thumbnail: cropped.thumbnail,
      });
    } catch (e) {
      console.warn("Flip Lens: failed to log entry:", e);
    }

    toast(
      copied
        ? "Copied! Press Ctrl/Cmd+V in the Google Lens tab to search."
        : "Saved to history. Clipboard blocked here — re-crop on the item if Lens has no image."
    );
  }

  // Crop the captured PNG to the selection. The capture is in device pixels,
  // so multiply CSS-pixel selection coords by devicePixelRatio. clientX/clientY
  // are viewport-relative, so scroll position needs no extra handling.
  async function cropDataUrl(dataUrl, rect, ratio) {
    const img = await loadImage(dataUrl);
    const sx = Math.round(rect.left * ratio);
    const sy = Math.round(rect.top * ratio);
    const sw = Math.round(rect.width * ratio);
    const sh = Math.round(rect.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );

    // Downscaled thumbnail for storage (keeps chrome.storage.local small).
    const thumb = makeThumbnail(img, sx, sy, sw, sh, 320);

    return { blob, thumbnail: thumb };
  }

  function makeThumbnail(img, sx, sy, sw, sh, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
    return c.toDataURL("image/png");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function toast(text) {
    const t = document.createElement("div");
    t.textContent = text;
    Object.assign(t.style, {
      position: "fixed",
      bottom: "24px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "12px 18px",
      background: "rgba(20,20,20,0.95)",
      color: "#fff",
      font: "14px/1.4 system-ui, sans-serif",
      borderRadius: "10px",
      zIndex: "2147483647",
      maxWidth: "80vw",
      textAlign: "center",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
    });
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
})();
