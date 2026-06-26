import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
} from "../repositories/itemRepository.js";
import { decodeDataUrl, extForContentType } from "../storage/index.js";

// `store` is the resolved object store (see storage/index.js).
export function itemsRouter(store) {
  const router = Router();

  const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  // List the caller's items, newest first.
  router.get(
    "/",
    wrap(async (req, res) => {
      const items = await listItems({ tenantId: req.tenantId, userId: req.userId });
      res.json({ items });
    })
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      const item = await getItem({ tenantId: req.tenantId, userId: req.userId, id: req.params.id });
      if (!item) return res.status(404).json({ error: "not_found" });
      res.json({ item });
    })
  );

  // Create an item. If `thumbnailDataUrl` is present it is stored in object
  // storage and only the resulting key/url are persisted on the row.
  router.post(
    "/",
    wrap(async (req, res) => {
      const body = req.body || {};
      const data = pickItemFields(body);

      if (body.thumbnailDataUrl) {
        const decoded = decodeDataUrl(body.thumbnailDataUrl);
        if (!decoded) return res.status(400).json({ error: "invalid_thumbnail_data_url" });
        const key = objectKey(req.tenantId, decoded.contentType);
        const { url } = await store.put(key, decoded.body, decoded.contentType);
        data.thumbnailKey = key;
        data.thumbnailUrl = url;
      }

      const item = await createItem({ tenantId: req.tenantId, userId: req.userId, data });
      res.status(201).json({ item });
    })
  );

  router.patch(
    "/:id",
    wrap(async (req, res) => {
      const body = req.body || {};
      const patch = pickItemFields(body, { partial: true });

      if (body.thumbnailDataUrl) {
        const decoded = decodeDataUrl(body.thumbnailDataUrl);
        if (!decoded) return res.status(400).json({ error: "invalid_thumbnail_data_url" });
        const key = objectKey(req.tenantId, decoded.contentType);
        const { url } = await store.put(key, decoded.body, decoded.contentType);
        patch.thumbnailKey = key;
        patch.thumbnailUrl = url;
      }

      const item = await updateItem({
        tenantId: req.tenantId,
        userId: req.userId,
        id: req.params.id,
        patch,
      });
      if (!item) return res.status(404).json({ error: "not_found" });
      res.json({ item });
    })
  );

  router.delete(
    "/:id",
    wrap(async (req, res) => {
      const removed = await deleteItem({
        tenantId: req.tenantId,
        userId: req.userId,
        id: req.params.id,
      });
      if (!removed) return res.status(404).json({ error: "not_found" });
      if (removed.thumbnailKey) {
        // Best-effort: orphaned objects are harmless and cheap.
        store.delete(removed.thumbnailKey).catch(() => {});
      }
      res.status(204).end();
    })
  );

  return router;
}

function objectKey(tenantId, contentType) {
  return `tenants/${tenantId}/thumbnails/${randomUUID()}.${extForContentType(contentType)}`;
}

// Maps the request body to storable fields. For create, missing fields fall back
// to repository defaults; for partial updates only present keys are forwarded.
function pickItemFields(body, { partial = false } = {}) {
  const out = {};
  const keys = [
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
  for (const k of keys) {
    if (partial) {
      if (k in body) out[k] = body[k];
    } else {
      out[k] = body[k];
    }
  }
  return out;
}
