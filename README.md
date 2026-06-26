# Flip Lens

A Manifest V3 Chrome extension that streamlines a **furniture / estate-sale
flipping research workflow**:

1. Click the pinned toolbar icon.
2. Drag-select an item on the page (like macOS **Cmd+Shift+4**).
3. The cropped image is copied to your clipboard and a **Google Lens** tab opens
   — paste (**Ctrl/Cmd+V**) to run a reverse-image search.
4. The item is logged to a **sortable history** in the Chrome side panel, with an
   editable description, an editable **resale value**, and a best-effort
   auto-scraped price + **confidence score**.

Everything runs **fully client-side** — no backend, no auth, no accounts. Auth
and a per-user backend are an explicit later phase.

---

## Features

- **One-click crop-and-capture** — a dimmed full-viewport overlay with a
  crosshair; drag to select, **Esc** to cancel. The crop accounts for
  `window.devicePixelRatio` so it matches your selection exactly.
- **Reverse image search via Google Lens** — the cropped PNG is copied to the
  clipboard and `https://lens.google.com/` opens in a new tab; you paste to
  search. The image is never written to your filesystem.
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

1. Clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** (top-right) **on**.
4. Click **Load unpacked** and select this repository's root folder (the one
   containing `manifest.json`).
5. **Pin the icon**: click the puzzle-piece (Extensions) button in the toolbar
   and click the pin next to **Flip Lens** so the icon is always visible.

> The crop overlay cannot run on restricted pages such as `chrome://*`, the
> Chrome Web Store, or `view-source:` pages. Try it on a normal website.

---

## Run the full flow

1. Browse to a page with an item you want to research (an estate-sale listing,
   marketplace photo, etc.).
2. Click the **Flip Lens** toolbar icon. The history **side panel** opens and a
   dimmed crop overlay appears on the page.
3. **Drag** a box around the item (press **Esc** to cancel). On mouse-up the
   cropped image is copied to your clipboard.
4. A **Google Lens** tab opens. Click into it and press **Ctrl/Cmd+V** to paste
   the image and run the search.
5. Switch back to the side panel: a new history entry has appeared with the
   cropped thumbnail. If the scraper found prices, the **resale value** is
   pre-filled with a **confidence badge**; otherwise it's blank for you to fill
   in. Edit the description and value inline — editing the value marks it
   **confirmed**.
6. Use the **Sort by** dropdown to rank items by **resale value** or date. Use
   **Open Lens** to re-run a search, or **Delete** to remove an entry.

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
  background.js                   Service worker: icon click, capture, messaging, Lens tab
  lib/storage.js                  chrome.storage.local history helpers (swappable for IndexedDB)
  content/
    crop-overlay.js               Drag-select overlay + crop + clipboard (injected on click)
    lens-extractor.js             ⚠ FRAGILE: Lens DOM selectors + confidence scoring (isolated)
    lens-scraper.js               Orchestrates the MutationObserver + messaging on Lens results
  sidepanel/
    panel.html / panel.css / panel.js   History UI (sort, inline edit, badges, delete)
icons/                            Toolbar / extension icons
```

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
- Hosting the cropped image so Lens search can run without a manual paste.
- Configurable comp sources and currency support.

## License

MIT
