// Background service worker (MV3, ES module).
//
// Responsibilities:
//  - On toolbar action click: open the side-panel history and inject the
//    crop-overlay content script into the active tab.
//  - Capture the visible tab when the overlay requests it (captureVisibleTab
//    requires an extension context, not a content script).
//  - Upload the cropped image directly to Google Lens (no clipboard paste) and
//    open the results page Lens returns in a new tab.
//  - Create a history entry after a capture.
//  - Inject the Lens results scraper into that tab, hand it its "job" (which
//    history entry to fill in), and apply scraped price + confidence back.

import { addEntry, updateEntry, getHistory } from "./lib/storage.js";

// Maps a Lens results tabId -> the history entry id awaiting a price scrape.
// Kept in chrome.storage.session so it survives service-worker suspension.
const PENDING_KEY = "flipLensPendingScrapes";

async function getPending() {
  const data = await chrome.storage.session.get(PENDING_KEY);
  return data[PENDING_KEY] || {};
}

async function setPending(map) {
  await chrome.storage.session.set({ [PENDING_KEY]: map });
}

// The side panel must be opened from a user gesture and via manual open()
// (not openPanelOnActionClick) because the action click is reserved for the
// crop flow.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;

  // Open the history side panel alongside the crop overlay so the user can
  // immediately watch new captures land. open() must run within the gesture.
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    // Some Chrome versions require a tabId; fall back to that.
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (_) {
      /* side panel optional; ignore */
    }
  }

  // Cannot inject into restricted pages (chrome://, the Web Store, etc.).
  const url = tab.url || "";
  if (/^(chrome|edge|about|chrome-extension|https:\/\/chrome\.google\.com\/webstore)/.test(url)) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/crop-overlay.js"],
    });
  } catch (e) {
    console.warn("Flip Lens: could not inject crop overlay:", e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "FLIPLENS_CAPTURE":
      handleCapture(sender, sendResponse);
      return true; // async response

    case "FLIPLENS_LOG_ENTRY":
      handleLogEntry(msg, sendResponse);
      return true;

    case "FLIPLENS_GET_SCRAPE_JOB":
      handleGetScrapeJob(sender, sendResponse);
      return true;

    case "FLIPLENS_SCRAPE_RESULT":
      handleScrapeResult(msg, sendResponse);
      return true;

    case "FLIPLENS_OPEN_LENS_FOR_ENTRY":
      chrome.tabs.create({ url: msg.lensUrl || "https://lens.google.com/" });
      return false;
  }
});

// Capture the currently visible tab and return the data URL. Cropping happens
// in the content script (which has a DOM canvas and clipboard access).
async function handleCapture(sender, sendResponse) {
  try {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "png",
    });
    sendResponse({ ok: true, dataUrl });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
}

// Create the history entry, run the Lens search, and open its results tab.
//
// Primary path: POST the cropped image straight to Lens's upload endpoint and
// open the results URL it returns — no clipboard, no manual paste. If that
// fails (network/region/Google changes), fall back to opening lens.google.com
// so the user can paste the image we already copied to their clipboard.
async function handleLogEntry(msg, sendResponse) {
  try {
    let lensUrl = null;
    let mode = "upload";

    if (msg.uploadImage) {
      try {
        lensUrl = toVisualMatchesUrl(await uploadToLens(msg.uploadImage));
      } catch (e) {
        console.warn("Flip Lens: Lens upload failed, falling back to paste:", e);
      }
    }
    if (!lensUrl) {
      lensUrl = "https://lens.google.com/";
      mode = "fallback";
    }

    const entry = await addEntry({
      thumbnail: msg.thumbnail,
      description: msg.description || "",
      lensUrl,
    });

    const lensTab = await chrome.tabs.create({ url: lensUrl });
    const pending = await getPending();
    pending[lensTab.id] = entry.id;
    await setPending(pending);

    sendResponse({ ok: true, entryId: entry.id, mode, lensUrl });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
}

// Upload a cropped image (data URL) to Google Lens and return the results URL.
// Lens accepts a multipart POST with an `encoded_image` field and responds with
// a 303 redirect to the results page; fetch follows it, so res.url is the final
// results URL. This is an unofficial endpoint and may need maintenance if
// Google changes it.
//
// NOTE: Lens rejects the request (403) when it carries an
// `Origin: chrome-extension://...` header, so a declarativeNetRequest rule
// (rules.json) strips the Origin header from this exact request.
async function uploadToLens(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const form = new FormData();
  form.append("encoded_image", blob, "fliplens.png");

  const res = await fetch(
    `https://lens.google.com/v3/upload?stcs=${Date.now()}`,
    { method: "POST", body: form }
  );

  const url = res && res.url;
  if (!url || !/google\.com\/search/.test(url)) {
    throw new Error("unexpected Lens upload response: " + url);
  }
  return url;
}

// Lens's upload redirect lands on the "All" surface (udm=26), which shows an AI
// overview and "about this image" — but NOT the for-sale price grid. The actual
// resale comps with "$NN" badges live on the "Visual matches" surface (udm=44),
// reached by switching the `udm` parameter. We open that surface directly so the
// flow stays zero-click AND the scraper has prices to read. This is an
// unofficial param and may need maintenance if Google changes it.
function toVisualMatchesUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/\/search/.test(u.pathname)) return rawUrl;
    u.searchParams.set("udm", "44");
    return u.toString();
  } catch (_) {
    return rawUrl;
  }
}

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?)(;base64)?$/) || [])[1] || "image/png";
  const bytes = atob(body);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// The Lens scraper asks which entry (if any) it should fill in.
async function handleGetScrapeJob(sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    sendResponse({ entryId: null });
    return;
  }
  const pending = await getPending();
  sendResponse({ entryId: pending[tabId] || null });
}

// Apply scraped price stats + confidence onto the entry, unless the user has
// already manually confirmed the value.
async function handleScrapeResult(msg, sendResponse) {
  try {
    const { entryId, stats, confidence, confidenceReason } = msg;
    if (!entryId) {
      sendResponse({ ok: false });
      return;
    }
    const list = await getHistory();
    const existing = list.find((e) => e.id === entryId);

    // Never clobber a value the user already entered/confirmed.
    if (existing && existing.userConfirmed) {
      sendResponse({ ok: true, skipped: "user-confirmed" });
      return;
    }

    await updateEntry(entryId, {
      resaleValue: stats && stats.median != null ? stats.median : (existing ? existing.resaleValue : null),
      priceStats: stats || null,
      confidence: confidence || "none",
      confidenceReason: confidenceReason || "",
    });
    sendResponse({ ok: true });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
}

// Once a pending Lens tab finishes loading its results page, inject the scraper
// (extractor + orchestrator) into it. We inject programmatically — rather than
// via a static content script — so the scraper only ever runs on result pages
// we opened, not on every Google search. Injection happens once per tab.
const INJECTED_KEY = "flipLensInjected";

async function getInjected() {
  const data = await chrome.storage.session.get(INJECTED_KEY);
  return data[INJECTED_KEY] || {};
}

async function setInjected(map) {
  await chrome.storage.session.set({ [INJECTED_KEY]: map });
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete") return;

  const pending = await getPending();
  if (!pending[tabId]) return;

  const url = (tab && tab.url) || "";
  // Only inject on the actual results page, not the bare lens.google.com home
  // page (the fallback paste flow lands on /search after the user pastes).
  if (!/^https:\/\/(www\.google\.com|lens\.google\.com)\/search/.test(url)) {
    return;
  }

  const injected = await getInjected();
  if (injected[tabId]) return;
  injected[tabId] = true;
  await setInjected(injected);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "src/content/lens-extractor.js",
        "src/content/lens-scraper.js",
      ],
    });
  } catch (e) {
    console.warn("Flip Lens: could not inject Lens scraper:", e);
  }
});

// Clean up per-tab state when a Lens tab closes.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const pending = await getPending();
  if (pending[tabId]) {
    delete pending[tabId];
    await setPending(pending);
  }
  const injected = await getInjected();
  if (injected[tabId]) {
    delete injected[tabId];
    await setInjected(injected);
  }
});
