import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { requireTenant } from "./middleware/tenant.js";
import { itemsRouter } from "./routes/items.js";
import { imagesRouter } from "./routes/images.js";

export function createApp(store) {
  const app = express();

  // Trust the first proxy hop so rate-limiting / IP logging see the real client
  // IP behind a load balancer (set TRUST_PROXY appropriately in prod).
  app.set("trust proxy", config.trustProxy);

  // Security headers. crossOriginResourcePolicy is relaxed so the extension can
  // load thumbnails served from /images cross-origin.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: false,
    })
  );

  app.use(compression());

  // CORS: with no auth yet, restrict to explicitly allowed origins. A wildcard
  // is only honored for local dev (CORS_ORIGINS=*); production must list the
  // extension origin(s), e.g. chrome-extension://<id>.
  const allowAll = config.corsOrigins.includes("*");
  app.use(
    cors({
      origin: allowAll ? true : config.corsOrigins,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "x-tenant-id", "x-user-id"],
      maxAge: 86400,
    })
  );

  // Thumbnails are sent as base64 data URLs; allow a generous body size.
  app.use(express.json({ limit: "12mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, storage: store.driver }));

  app.use("/images", imagesRouter(store));

  // Basic abuse protection: per-IP rate limit on the API surface.
  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited" },
  });

  // Everything under /api requires a tenant/user context (auth stub for now).
  app.use("/api", apiLimiter, requireTenant);
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
