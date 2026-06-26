// Storage adapter for the history list.
//
// This is the single seam between the app and where data lives. It delegates to
// either the local store (chrome.storage.local — the default, offline MVP
// behavior) or the remote store (the Flip Lens API) based on config. Callers
// (background service worker, side panel) use this module unchanged regardless
// of backend.
//
// All MV3 service-worker imports must be static (no dynamic import()), so both
// stores are imported up front; only one is used per call.

import { Confidence } from "./schema.js";
import { getBackendConfig } from "./config.js";
import * as localStore from "./localStore.js";
import * as remoteStore from "./remoteStore.js";

export { Confidence };

async function activeStore() {
  const cfg = await getBackendConfig();
  return cfg.enabled ? remoteStore : localStore;
}

export async function getHistory() {
  return (await activeStore()).getHistory();
}

export async function addEntry(entry) {
  return (await activeStore()).addEntry(entry);
}

export async function updateEntry(id, patch) {
  return (await activeStore()).updateEntry(id, patch);
}

export async function deleteEntry(id) {
  return (await activeStore()).deleteEntry(id);
}

// Live updates from chrome.storage are local-only. The local listener is always
// registered (harmless and free); the remote store has no push channel, so when
// the backend is enabled the panel updates on open / on its own writes.
export function onHistoryChanged(callback) {
  localStore.onHistoryChanged(callback);
}
