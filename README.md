# Flip Lens

A Manifest V3 Chrome extension that streamlines a **furniture / estate-sale
flipping research workflow**:

1. Click the pinned toolbar icon (or press **Ctrl/Cmd+Shift+Y**).
2. Drag-select an item on the page (like macOS **Cmd+Shift+4**) — or drag an
   image file straight into the side panel.
3. The cropped image is **uploaded to Google Lens automatically** and the results
   open in a new tab — no extra clicks, no manual paste.
4. The item is logged to a **sortable history** in the Chrome side panel, with an
   editable description, an editable **resale value**, and a best-effort
   auto-scraped price + **confidence score**.

Everything runs **fully client-side** — no backend, no auth, no accounts. Auth
and a per-user backend are an explicit later phase.

---

## Features

- **One-click crop-and-capture** — trigger from the toolbar icon **or the
  keyboard shortcut** (`Ctrl/Cmd+Shift+Y`, rebindable at
  `chrome://extensions/shortcuts`). A dimmed full-viewport overlay with a
  crosshair appears; drag to select, **Esc** to cancel. The crop accounts for
  `window.devicePixelRatio` so it matches your selection exactly.
- **Drag-and-drop search** — drop an image file anywhere on the history side
  panel to run the same Google Lens search and log a new entry (no cropping
  needed). Useful for photos you already have saved.
- **Automatic reverse image search via Google Lens** — the cropped PNG is
  uploaded straight to Google Lens (`POST https://lens.google.com/v3/upload`) and
  the results page opens in a new tab automatically. No clipboard paste, no
  backend, and the image is never written to your filesystem. (If the upload ever
  fails, it falls back to opening Lens with the image on your clipboard to paste.)
- **Best-effort resale price scrape with a confidence score** — a content script
  on the Lens results page collects visible price strings from for-sale/sold
  match listings, computes min / median / max, and assigns a confidence tier
  (`high` / `medium` / `low` / `none`) plus a human-readable reason. This is a
  **bonus** that degrades gracefully and never blocks the core flow.
- **History side panel** — thumbnail, description, resale value, date, and a
  **confidence badge** that visually flags low-confidence auto-values. Sort by
  resale value or date; re-open the Lens search; inline-edit; delete.
- **Manual override** — the resale value is always editable. Editing it marks the
  entry as **user-confirmed** and clears any low-confidence warning.
- **Local storage** — history persists in `chrome.storage.local`. No server.

---

## Install (load unpacked)

You can load the repo directly, or build a self-contained zip first.

**Option A — load the repo directly**

1. Clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** (top-right) **on**.
4. Click **Load unpacked** and select this repository's root folder (the one
   containing `manifest.json`).
5. **Pin the icon**: click the puzzle-piece (Extensions) button in the toolbar
   and click the pin next to **Flip Lens** so the icon is always visible.

**Option B — build a distributable zip**

1. Run `npm run package` (or `./scripts/package.sh`). This writes
   `dist/flip-lens-<version>.zip` containing only the runtime files.
2. Unzip it anywhere, then follow steps 2–5 above, selecting the unzipped
   folder in step 4.

> The crop overlay cannot run on restricted pages such as `chrome://*`, the
> Chrome Web Store, or `view-source:` pages. Try it on a normal website.

---

## Run the full flow

1. Browse to a page with an item you want to research (an estate-sale listing,
   marketplace photo, etc.).
2. Click the **Flip Lens** toolbar icon. The history **side panel** opens and a
   dimmed crop overlay appears on the page.
3. **Drag** a box around the item (press **Esc** to cancel). On mouse-up the
   crop is uploaded to Google Lens automatically.
4. A **Google Lens** results tab opens on its own with the reverse-image search
   already run — no paste needed.
5. Switch back to the side panel: a new history entry has appeared with the
   cropped thumbnail. If the scraper found prices, the **resale value** is
   pre-filled with a **confidence badge**; otherwise it's blank for you to fill
   in. Edit the description and value inline — editing the value marks it
   **confirmed**.
6. Use the **Sort by** dropdown to rank items by **resale value** or date. Use
   **Open Lens** to re-run a search, or **Delete** to remove an entry.

**Two shortcuts to the same flow:**

- **Keyboard:** press **Ctrl/Cmd+Shift+Y** instead of clicking the toolbar icon
  to start the crop overlay. Change the binding at `chrome://extensions/shortcuts`.
- **Drag a file:** drag any image file onto the side panel and drop it — Flip
  Lens uploads it to Google Lens and logs a new entry, exactly like a crop.

**Recrop to fix a wrong match:** if Lens latches onto the wrong item, start the
crop overlay again **while you're on the Lens results tab** (toolbar icon or
**Ctrl/Cmd+Shift+Y**) and drag a tighter box around the right item. Flip Lens
re-runs the search and **updates that same history entry** in place — new
thumbnail and freshly re-scraped price/title/comps — instead of creating a
duplicate. (Cropping on a normal web page still creates a new entry.)

---

## Confidence scoring

The auto-scraped resale value carries a confidence tier so you know whether to
trust it:

| Tier      | Treatment           | Example reason                                   |
| --------- | ------------------- | ------------------------------------------------ |
| `high`    | green / positive    | "4 clustered prices from comp sources (e.g. ebay)" |
| `medium`  | amber               | "3 prices found, moderate spread"                |
| `low`     | ⚠ warning           | "only 1 price found" / "prices ranged widely"    |
| `none`    | hidden / unknown    | "no prices found on the Lens results"            |

It is derived from the number of distinct price points, the spread/variance
between them (tight cluster → higher confidence), and whether prices came from
recognized comp sources (eBay, Etsy, Mercari, …) versus arbitrary page text.
**User-confirmed** values display a "✓ confirmed" badge instead.

---

## Project structure

```
manifest.json                     MV3 manifest (permissions, action, side panel)
src/
  background.js                   Service worker: icon click, capture, Lens upload, messaging
  lib/
    storage.js                    Storage adapter — delegates to local or remote store
    localStore.js                 Default: chrome.storage.local (offline MVP behavior)
    remoteStore.js                REST client for the Flip Lens API (server/)
    config.js                     Backend toggle (local by default) + tenant/user
    schema.js                     Shared constants (Confidence tiers)
  content/
    crop-overlay.js               Drag-select overlay + crop (injected on click)
    lens-extractor.js             ⚠ FRAGILE: Lens DOM selectors + confidence scoring (isolated)
    lens-scraper.js               Orchestrates the MutationObserver + messaging on Lens results
  sidepanel/
    panel.html / panel.css / panel.js   History UI (sort, inline edit, badges, delete)
icons/                            Toolbar / extension icons
server/                           Multi-tenant API + Postgres + object storage (see server/README.md)
```

## Backend (groundwork)

The extension is local-only by default. A `server/` package adds a
multi-tenant-ready API (Node + Express + Postgres) with thumbnails in object
storage (local-disk dev driver, S3/Cloudflare R2 for prod) — **no auth yet**,
built so going live is just: add auth to one middleware, set env vars, deploy.
See [`server/README.md`](server/README.md) to run it locally.

To point the extension at it, set the `flipLensSettings` key in
`chrome.storage.local` (e.g. from the side-panel devtools console):

```js
chrome.storage.local.set({ flipLensSettings: { enabled: true, baseUrl: "http://localhost:8787" } })
```

Note: cross-origin requests from the extension to the API require a matching
entry in `host_permissions` in `manifest.json` (e.g. `"http://localhost:8787/*"`
for local dev, or your deployed API origin). This is intentionally left out
while the remote store is disabled by default.

---

## ⚠️ A note on the price scraper

The Google Lens results scraper (`src/content/lens-extractor.js` +
`lens-scraper.js`) is **best-effort and non-API**. Google ships no public API
for Lens results and changes its DOM frequently, so the selectors and heuristics
**will break over time**. All the fragile logic — the selectors *and* the
confidence scoring — is isolated in `lens-extractor.js` so it is easy to update.
If scraping fails, nothing breaks: the entry is still logged and you enter the
resale value manually (confidence shows as "none").

---

## Roadmap (later phases)

- Authentication and a per-user backend to sync history across devices.
- Configurable comp sources and currency support.

## License

MIT
