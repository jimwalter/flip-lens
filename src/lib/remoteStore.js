// Remote history store: talks to the Flip Lens API (server/).
//
// Implements the same API as localStore so it's a drop-in via storage.js. The
// server persists thumbnails in object storage and returns a URL, so we send
// the cropped data URL on create and render the returned `thumbnailUrl`.
//
// No auth yet: tenant/user come from config and are sent as dev headers; once
// real auth ships the server derives them from the session and ignores these.

import { Confidence } from "./schema.js";
import { getBackendConfig } from "./config.js";

async function api(path, options = {}) {
  const cfg = await getBackendConfig();
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-tenant-id": cfg.tenantId,
      "x-user-id": cfg.userId,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`flip-lens API ${options.method || "GET"} ${path} -> ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// API item (snake-ish camelCase from server) -> client entry shape.
function itemToEntry(item) {
  if (!item) return null;
  return {
    id: item.id,
    createdAt: item.createdAt ? Date.parse(item.createdAt) : Date.now(),
    thumbnail: item.thumbnailUrl || "",
    title: item.title || "",
    description: item.description || "",
    resaleValue: item.resaleValue ?? null,
    confidence: item.confidence || Confidence.NONE,
    confidenceReason: item.confidenceReason || "",
    userConfirmed: Boolean(item.userConfirmed),
    sourceUrl: item.sourceUrl || "",
    lensUrl: item.lensUrl || "https://lens.google.com/",
    priceStats: item.priceStats || null,
    marketStats: item.marketStats || null,
    comps: Array.isArray(item.comps) ? item.comps : [],
  };
}

// Client entry/patch -> API body. A data-URL thumbnail is sent for upload.
function entryToBody(entry) {
  const body = {};
  const fields = [
    "title",
    "description",
    "resaleValue",
    "confidence",
    "confidenceReason",
    "userConfirmed",
    "sourceUrl",
    "lensUrl",
    "priceStats",
    "marketStats",
    "comps",
  ];
  for (const f of fields) {
    if (entry[f] !== undefined) body[f] = entry[f];
  }
  if (typeof entry.thumbnail === "string" && entry.thumbnail.startsWith("data:")) {
    body.thumbnailDataUrl = entry.thumbnail;
  }
  return body;
}

// The API is keyset-paginated (?limit&cursor). The side panel expects the full
// history, so page through here until exhausted (with a safety cap). A future
// enhancement could expose incremental pages for infinite scroll.
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

export async function getHistory() {
  const entries = [];
  let cursor = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) qs.set("cursor", cursor);
    const data = await api(`/api/items?${qs.toString()}`);
    for (const item of data?.items || []) entries.push(itemToEntry(item));
    cursor = data?.nextCursor || null;
    if (!cursor) break;
  }
  return entries;
}

export async function addEntry(entry) {
  const data = await api("/api/items", {
    method: "POST",
    body: JSON.stringify(entryToBody(entry)),
  });
  return itemToEntry(data.item);
}

export async function updateEntry(id, patch) {
  const data = await api(`/api/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(entryToBody(patch)),
  });
  return itemToEntry(data.item);
}

export async function deleteEntry(id) {
  await api(`/api/items/${id}`, { method: "DELETE" });
}

// The REST API has no change-push channel, so cross-context live updates aren't
// available with the remote store (the panel refreshes on open / on its own
// writes). A future enhancement could poll or use SSE/WebSocket.
export function onHistoryChanged() {
  /* no-op for remote store */
}
