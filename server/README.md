# Flip Lens backend (MVP groundwork)

A small, multi-tenant-ready API for the Flip Lens extension. **No auth yet** —
this is the groundwork so that going live later is just: build auth into one
middleware, set env vars, and deploy.

## What's here

- **Node + Express** JSON API (`/api/items` CRUD + `/health`).
- **Postgres** schema where every row carries `tenant_id` + `user_id`
  (`migrations/001_init.sql`). A default tenant/user is seeded for the auth-less MVP.
- **Object storage for thumbnails** behind a small interface
  (`src/storage/`): `local` disk driver (dev default) or any S3-compatible
  bucket (`s3`), e.g. **Cloudflare R2** (recommended at scale — zero egress).
  The DB stores only the object key + URL, never image bytes.
- **`requireTenant` middleware** (`src/middleware/tenant.js`) — the single place
  to add real auth. It currently injects the default tenant/user.

## Why images go to object storage (not the DB, not re-fetched)

The thumbnail is a cropped sub-region of a screenshot of the visible tab at
capture time. There is no addressable URL to re-fetch that exact crop (the source
page changes / may require login; the Lens upload URL is ephemeral), so it must be
persisted. Object storage + CDN is the cheapest and fastest way to serve it at
scale; base64 in Postgres bloats rows ~33% and kills query/IO performance. We do
keep `source_url` + `lens_url` as cheap context metadata.

## Run locally

```bash
cd server
cp .env.example .env
docker compose up -d db        # Postgres on :5432
npm install
npm run migrate                # create schema + seed default tenant/user
npm start                      # API on :8787 (storage=local)
```

Quick check:

```bash
curl localhost:8787/health
curl localhost:8787/api/items
```

## API

All `/api` routes resolve a tenant/user via `requireTenant` (default until auth).
You can override during dev with `x-tenant-id` / `x-user-id` headers.

| Method | Path             | Body                                              | Notes |
|--------|------------------|---------------------------------------------------|-------|
| GET    | `/api/items`     | —                                                 | newest first |
| GET    | `/api/items/:id` | —                                                 | |
| POST   | `/api/items`     | item fields + optional `thumbnailDataUrl`         | stores image, returns `thumbnailUrl` |
| PATCH  | `/api/items/:id` | partial item fields (+ optional `thumbnailDataUrl`) | inline edits / confirm |
| DELETE | `/api/items/:id` | —                                                 | also deletes the object (best-effort) |

Item fields: `title`, `description`, `resaleValue`, `confidence`,
`confidenceReason`, `userConfirmed`, `sourceUrl`, `lensUrl`, `priceStats`,
`marketStats`, `comps`.

## Switch to S3 / Cloudflare R2

Set in `.env`:

```
STORAGE_DRIVER=s3
S3_BUCKET=flip-lens
S3_REGION=auto
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://<your-cdn-or-public-bucket>
```

## Remaining to go live (later)

1. Implement auth inside `requireTenant` (session/JWT/API key) and create
   tenants/users on signup.
2. Optionally enable Postgres row-level security (template in `001_init.sql`).
3. Point the extension at the API (`RemoteStore`, see `../src/lib/`).
4. Provision Postgres + R2 and deploy.
