import { Router } from "express";
import express from "express";

// Dev-only static serving for the local-disk object store. In production the
// S3/R2 bucket (CDN-fronted) serves thumbnails directly, so this route is unused.
export function imagesRouter(store) {
  const router = Router();
  if (store.driver === "local" && store.localRoot) {
    router.use(
      express.static(store.localRoot, {
        immutable: true,
        maxAge: "1y",
        fallthrough: false,
      })
    );
  } else {
    router.use((_req, res) => res.status(404).json({ error: "not_found" }));
  }
  return router;
}
