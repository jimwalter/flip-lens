// Side-panel history UI.
//
// Renders the history list with thumbnail, editable description + resale value,
// a confidence badge for auto-scraped values, sorting, "Open Lens", and delete.
// Manual edits to the resale value mark the entry as user-confirmed and clear
// any low-confidence warning.

import {
  getHistory,
  updateEntry,
  deleteEntry,
  onHistoryChanged,
} from "../lib/storage.js";

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const sortEl = document.getElementById("sort");
const tpl = document.getElementById("row-tpl");

let entries = [];

sortEl.addEventListener("change", render);

function sortEntries(list) {
  const mode = sortEl.value;
  const copy = [...list];
  const val = (e) => (e.resaleValue == null ? -Infinity : Number(e.resaleValue));
  switch (mode) {
    case "date-asc":
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    case "value-desc":
      return copy.sort((a, b) => val(b) - val(a));
    case "value-asc":
      return copy.sort((a, b) => {
        const av = a.resaleValue == null ? Infinity : Number(a.resaleValue);
        const bv = b.resaleValue == null ? Infinity : Number(b.resaleValue);
        return av - bv;
      });
    case "date-desc":
    default:
      return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

function applyBadge(badgeEl, entry) {
  badgeEl.className = "badge";
  if (entry.userConfirmed) {
    badgeEl.classList.add("confirmed");
    badgeEl.textContent = "✓ confirmed";
    badgeEl.title = "You entered or confirmed this value.";
    return;
  }
  const tier = entry.confidence || "none";
  badgeEl.classList.add(tier);
  if (tier === "none") {
    badgeEl.textContent = "";
    badgeEl.title = "";
    return;
  }
  const label = { low: "⚠ low", medium: "~ medium", high: "✓ high" }[tier] || tier;
  badgeEl.textContent = label + " confidence";
  badgeEl.title = entry.confidenceReason || "";
}

// Display names for recognized comp sources (the scraper stores lowercase keys).
const SOURCE_LABELS = {
  ebay: "eBay",
  etsy: "Etsy",
  mercari: "Mercari",
  poshmark: "Poshmark",
  "facebook marketplace": "FB Marketplace",
  chairish: "Chairish",
  "1stdibs": "1stDibs",
  offerup: "OfferUp",
  amazon: "Amazon",
  wayfair: "Wayfair",
};

// Render the comp listings as clickable chips that open the source listing in a
// new tab. Built with DOM APIs (textContent) so scraped strings can't inject
// markup.
function renderComps(container, comps) {
  container.textContent = "";
  if (!Array.isArray(comps) || !comps.length) {
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";
  for (const c of comps) {
    if (!c || !c.url) continue;
    const a = document.createElement("a");
    a.className = "comp";
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const label = SOURCE_LABELS[c.source] || c.source;
    a.textContent = `${label} $${c.value}`;
    a.title = c.text || c.url;
    container.appendChild(a);
  }
}

function makeRow(entry) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const thumb = node.querySelector(".thumb");
  const title = node.querySelector(".title");
  const desc = node.querySelector(".desc");
  const value = node.querySelector(".value");
  const badge = node.querySelector(".badge");
  const date = node.querySelector(".date");
  const stats = node.querySelector(".stats");
  const market = node.querySelector(".market");
  const comps = node.querySelector(".comps");
  const lensBtn = node.querySelector(".lens-btn");
  const delBtn = node.querySelector(".del-btn");

  thumb.src = entry.thumbnail || "";
  title.value = entry.title || "";
  desc.value = entry.description || "";
  value.value = entry.resaleValue == null ? "" : entry.resaleValue;
  date.textContent = fmtDate(entry.createdAt);

  // Primary stats: the comp set the estimate is based on (count + range).
  const s = entry.priceStats;
  if (s && s.count) {
    const noun = s.count === 1 ? "comp" : "comps";
    stats.textContent =
      s.min === s.max
        ? `${s.count} ${noun} · $${s.min}`
        : `${s.count} ${noun} · $${s.min}–$${s.max}`;
  } else {
    stats.textContent = "";
  }

  // Market range: the full observed spread across all matches, shown only when
  // it adds information beyond the comp range above.
  const m = entry.marketStats;
  if (m && m.count && s && (m.min !== s.min || m.max !== s.max)) {
    market.textContent = `market $${m.min}–$${m.max}`;
    market.title = `${m.count} prices observed across all visual matches`;
  } else {
    market.textContent = "";
  }

  renderComps(comps, entry.comps);

  applyBadge(badge, entry);

  // Title editing (saved on blur / Enter).
  const saveTitle = () => {
    if (title.value !== (entry.title || "")) {
      updateEntry(entry.id, { title: title.value });
    }
  };
  title.addEventListener("blur", saveTitle);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });

  // Description editing (saved on blur / Enter).
  const saveDesc = () => {
    if (desc.value !== (entry.description || "")) {
      updateEntry(entry.id, { description: desc.value });
    }
  };
  desc.addEventListener("blur", saveDesc);
  desc.addEventListener("keydown", (e) => {
    if (e.key === "Enter") desc.blur();
  });

  // Resale value editing → mark user-confirmed and clear low-confidence flag.
  const saveValue = () => {
    const raw = value.value.trim();
    const num = raw === "" ? null : Number(raw);
    if (num != null && !Number.isFinite(num)) return;
    const patch = {
      resaleValue: num,
      userConfirmed: true,
      confidence: "none",
      confidenceReason: "",
    };
    updateEntry(entry.id, patch);
  };
  value.addEventListener("change", saveValue);
  value.addEventListener("keydown", (e) => {
    if (e.key === "Enter") value.blur();
  });

  lensBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "FLIPLENS_OPEN_LENS_FOR_ENTRY",
      lensUrl: entry.lensUrl || "https://lens.google.com/",
    });
  });

  delBtn.addEventListener("click", () => {
    deleteEntry(entry.id);
  });

  return node;
}

function render() {
  const sorted = sortEntries(entries);
  listEl.innerHTML = "";
  if (!sorted.length) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  const frag = document.createDocumentFragment();
  for (const entry of sorted) frag.appendChild(makeRow(entry));
  listEl.appendChild(frag);
}

async function init() {
  entries = await getHistory();
  render();
  onHistoryChanged((newList) => {
    entries = newList || [];
    render();
  });
}

init();
