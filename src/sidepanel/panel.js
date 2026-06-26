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

function makeRow(entry) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const thumb = node.querySelector(".thumb");
  const title = node.querySelector(".title");
  const desc = node.querySelector(".desc");
  const value = node.querySelector(".value");
  const badge = node.querySelector(".badge");
  const date = node.querySelector(".date");
  const stats = node.querySelector(".stats");
  const lensBtn = node.querySelector(".lens-btn");
  const delBtn = node.querySelector(".del-btn");

  thumb.src = entry.thumbnail || "";
  title.value = entry.title || "";
  desc.value = entry.description || "";
  value.value = entry.resaleValue == null ? "" : entry.resaleValue;
  date.textContent = fmtDate(entry.createdAt);

  if (entry.priceStats && entry.priceStats.count) {
    const s = entry.priceStats;
    stats.textContent = `${s.count} prices · $${s.min}–$${s.max}`;
  } else {
    stats.textContent = "";
  }

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
