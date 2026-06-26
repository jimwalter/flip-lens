// Background service worker (MV3, ES module).
//
// Responsibilities:
//  - On toolbar action click: open the side-panel history and inject the
//    crop-overlay content script into the active tab.
//  - Capture the visible tab when the overlay requests it (captureVisibleTab
//    requires an extension context, not a content script).
//  - Create a history entry after a capture and open Google Lens in a new tab.
//  - Hand the Lens results scraper its "job" (which history entry to fill in)
//    and apply scraped price + confidence back onto that entry.

import { addEntry, updateEntry } from "./lib/storage.js";

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

// Create the history entry and open Google Lens in a new tab. The new tab is
// registered as the pending scrape target for this entry.
async function handleLogEntry(msg, sendResponse) {
  try {
    const lensUrl = "https://lens.google.com/";
    const entry = await addEntry({
      thumbnail: msg.thumbnail,
      description: msg.description || "",
      lensUrl,
    });

    const lensTab = await chrome.tabs.create({ url: lensUrl });
    const pending = await getPending();
    pending[lensTab.id] = entry.id;
    await setPending(pending);

    sendResponse({ ok: true, entryId: entry.id });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
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
    const { getHistory } = await import("./lib/storage.js");
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

// Clean up pending-scrape entries when their Lens tab closes.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const pending = await getPending();
  if (pending[tabId]) {
    delete pending[tabId];
    await setPending(pending);
  }
});
