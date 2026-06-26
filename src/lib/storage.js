// Shared storage helpers for the history list.
// History is persisted in chrome.storage.local. Each entry holds a cropped
// thumbnail data URL, an editable description, an (editable) resale value, the
// auto-scraped confidence tier + reason, the Google Lens URL, and a timestamp.
//
// Data URLs can be large; chrome.storage.local has a generous quota
// (>= 5MB, and effectively unlimited for the local area in MV3) which is
// sufficient for the MVP. Thumbnails are downscaled before storage to stay
// well under quota. If this ever proves too small, swap the read/write
// helpers below for an IndexedDB-backed implementation — the rest of the app
// only depends on this module's API.

const HISTORY_KEY = "flipLensHistory";

export const Confidence = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "none",
});

export async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const list = data[HISTORY_KEY];
  return Array.isArray(list) ? list : [];
}

async function setHistory(list) {
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
}

export async function addEntry(entry) {
  const list = await getHistory();
  const full = {
    id: entry.id || crypto.randomUUID(),
    createdAt: entry.createdAt || Date.now(),
    thumbnail: entry.thumbnail || "",
    title: entry.title || "",
    description: entry.description || "",
    resaleValue: entry.resaleValue ?? null,
    confidence: entry.confidence || Confidence.NONE,
    confidenceReason: entry.confidenceReason || "",
    userConfirmed: entry.userConfirmed || false,
    lensUrl: entry.lensUrl || "https://lens.google.com/",
    priceStats: entry.priceStats || null,
  };
  list.unshift(full);
  await setHistory(list);
  return full;
}

export async function updateEntry(id, patch) {
  const list = await getHistory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  await setHistory(list);
  return list[idx];
}

export async function deleteEntry(id) {
  const list = await getHistory();
  await setHistory(list.filter((e) => e.id !== id));
}

export function onHistoryChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[HISTORY_KEY]) {
      callback(changes[HISTORY_KEY].newValue || []);
    }
  });
}
