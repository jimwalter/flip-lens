import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { requireTenant } from "./middleware/tenant.js";
import { itemsRouter } from "./routes/items.js";
import { imagesRouter } from "./routes/images.js";

export function createApp(store) {
  const app = express();

  const corsOptions =
    config.corsOrigins.includes("*") ? {} : { origin: config.corsOrigins };
  app.use(cors(corsOptions));

  // Thumbnails are sent as base64 data URLs; allow a generous body size.
  app.use(express.json({ limit: "12mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, storage: store.driver }));

  app.use("/images", imagesRouter(store));

  // Everything under /api requires a tenant/user context (auth stub for now).
  app.use("/api", requireTenant);
  app.use("/api/items", itemsRouter(store));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status === 404 ? "not_found" : "internal_error",
      message: err.message,
    });
  });

  return app;
}
