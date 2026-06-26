// Client config for where history is stored.
//
// Default is fully local (chrome.storage.local) so the extension works with no
// backend, exactly as before. Flip `enabled` on (or set it via
// chrome.storage.local key "flipLensSettings") to point the extension at the
// Flip Lens API instead — no other code changes required.
//
// Until real auth ships, the server resolves a default tenant/user; these IDs
// are sent as dev override headers and become irrelevant once auth is added.

const SETTINGS_KEY = "flipLensSettings";

const DEFAULTS = Object.freeze({
  enabled: false,
  baseUrl: "http://localhost:8787",
  tenantId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000001",
});

export async function getBackendConfig() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const stored = data[SETTINGS_KEY] || {};
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}
