import { config } from "../config.js";
import { createLocalDiskStore } from "./localDiskStore.js";
import { createS3Store } from "./s3Store.js";

// Resolves the configured object store. The rest of the app depends only on the
// { put(key, body, contentType), delete(key) } interface, so storage backends
// are interchangeable.
export async function createObjectStore() {
  const s = config.storage;
  if (s.driver === "s3") {
    return createS3Store(s.s3);
  }
  return createLocalDiskStore({ dir: s.localDir, publicBaseUrl: s.publicBaseUrl });
}

// Extracts raw bytes + content type from a data URL (e.g. "data:image/png;base64,...").
export function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!m) return null;
  const contentType = m[1] || "application/octet-stream";
  const isBase64 = Boolean(m[2]);
  const body = isBase64 ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { contentType, body };
}

const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function extForContentType(contentType) {
  return EXT_BY_TYPE[contentType] || "bin";
}
