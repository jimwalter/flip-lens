// =============================================================================
// Flip Lens — Google Lens price extractor + confidence scoring.
//
// ⚠️ FRAGILE / NON-API: This module screen-scrapes the Google Lens results
// page. Google ships no public API for this and changes its DOM frequently, so
// the selectors and heuristics below WILL break over time. Everything that is
// likely to need maintenance is isolated in THIS file:
//   - SELECTORS / price extraction (`extractPrices`)
//   - confidence scoring (`scoreConfidence`)
// The orchestration (MutationObserver, timeouts, messaging) lives in
// lens-scraper.js and should not need DOM-specific edits.
//
// The scraper must degrade gracefully: if nothing matches, it returns no
// prices and confidence "none" — the manual flow in the side panel still works.
// =============================================================================

(() => {
  // Recognized resale-comparison sources. Prices sourced from these get a
  // confidence boost; arbitrary page text does not.
  const COMP_SOURCES = [
    "ebay",
    "etsy",
    "mercari",
    "poshmark",
    "facebook marketplace",
    "chairish",
    "1stdibs",
    "offerup",
    "amazon",
    "wayfair",
  ];

  // A price tag is rendered as its own leaf element, e.g. "$30", "$1,234.56",
  // sometimes with a trailing "*" (Lens uses it for "check site for pricing").
  const PRICE_EXACT_RE = /^\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\*?$/;

  function parsePrice(str) {
    const num = parseFloat(String(str).replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  function isMerchantAnchor(a) {
    let host = "";
    try {
      host = new URL(a.href).hostname.toLowerCase();
    } catch (_) {
      return false;
    }
    // Skip Google's own links (related searches, AI overview, nav, etc.).
    return host && !/(^|\.)google\.[a-z.]+$/.test(host) && !host.includes("gstatic.");
  }

  // Extract prices from the Lens "Visual matches" grid and pair each with the
  // listing it belongs to.
  //
  // IMPORTANT (fragile): each price is NOT inside the listing's <a> — it is an
  // absolutely-positioned overlay rendered as a sibling that appears in DOM
  // order immediately BEFORE the listing's anchor. So we collect price leaves
  // and merchant anchors, order them by document position, and pair every price
  // with the first merchant anchor that follows it (its own card), reading the
  // comp source from that anchor's hostname.
  //
  // Returns: [{ value:Number, source:String|null, text:String }]
  function extractPrices(root = document) {
    const scope = root && root.querySelectorAll ? root : document;

    const priceEls = [];
    scope.querySelectorAll("span, div, b").forEach((el) => {
      if (el.children.length) return; // leaf nodes only
      const t = (el.textContent || "").trim();
      if (PRICE_EXACT_RE.test(t)) priceEls.push(el);
    });

    const anchorEls = [];
    scope.querySelectorAll("a[href]").forEach((a) => {
      if (isMerchantAnchor(a)) anchorEls.push(a);
    });

    if (!priceEls.length) return [];

    // Merge both sets and sort by document order.
    const ordered = [
      ...priceEls.map((el) => ({ el, kind: "price" })),
      ...anchorEls.map((el) => ({ el, kind: "anchor" })),
    ].sort((a, b) => {
      const rel = a.el.compareDocumentPosition(b.el);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const found = [];
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].kind !== "price") continue;
      const value = parsePrice(ordered[i].el.textContent);
      // Filter implausible values (Lens UI chrome, ratings, etc.).
      if (value == null || value < 1 || value > 100000) continue;

      let source = null;
      let text = (ordered[i].el.textContent || "").trim();
      // Pair with the first merchant anchor before the next price (same card).
      for (let j = i + 1; j < ordered.length && ordered[j].kind !== "price"; j++) {
        const a = ordered[j].el;
        let host = "";
        try {
          host = new URL(a.href).hostname.toLowerCase();
        } catch (_) {
          /* keep null */
        }
        const haystack = host + " " + (a.innerText || a.textContent || "").toLowerCase();
        source = COMP_SOURCES.find((s) => haystack.includes(s)) || null;
        text = (a.innerText || a.textContent || text).trim().slice(0, 120);
        break;
      }
      found.push({ value, source, text });
    }

    // De-duplicate identical value+source pairs (defensive against repeats).
    const uniq = [];
    const seen = new Set();
    for (const p of found) {
      const key = p.value + "|" + (p.source || "");
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(p);
    }
    return uniq;
  }

  // Prefer prices from recognized resale comp sources (eBay, Mercari, etc.)
  // when there are enough of them — they reflect actual resale value far better
  // than the wide mix of loosely-related Visual matches. Falls back to all
  // prices when comps are sparse.
  function pickPriceSet(prices) {
    const comps = prices.filter((p) => p.source);
    return comps.length >= 3 ? comps : prices;
  }

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function titleCase(s) {
    return s.replace(/\w[\w'-]*/g, (w) =>
      w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w
    );
  }

  // Best-effort item title + description scraped from the Lens results.
  //
  // FRAGILE / NON-API (same caveat as extractPrices): Google ships no API for
  // this, so it relies on page structure that may change.
  //   - title:       Google's "Related searches" are short query phrases that
  //                  name the item well (e.g. "Eames Lounge Chair"). They render
  //                  as anchors to /search?q=<phrase>, so we read those.
  //   - description: the most descriptive for-sale listing title in the grid,
  //                  preferring recognized comp sources (eBay/Etsy/etc.).
  // Returns { title:String, description:String } (either may be "").
  function extractItemInfo(root = document) {
    const scope = root && root.querySelectorAll ? root : document;

    // --- Title from related-search phrases ---
    const related = [];
    scope.querySelectorAll("a[href]").forEach((a) => {
      let u;
      try {
        u = new URL(a.href, location.href);
      } catch (_) {
        return;
      }
      if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname)) return;
      if (!/\/search/.test(u.pathname)) return;
      if (!u.searchParams.get("q")) return;
      const t = cleanText(a.innerText || a.textContent);
      const words = t ? t.split(/\s+/) : [];
      if (t.length >= 3 && t.length <= 50 && words.length >= 1 && words.length <= 6) {
        related.push(t);
      }
    });

    let title = "";
    if (related.length) {
      // Most frequent phrase wins; tie-break toward the shorter one.
      const counts = new Map();
      for (const t of related) {
        const key = t.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      related.sort((a, b) => {
        const diff = counts.get(b.toLowerCase()) - counts.get(a.toLowerCase());
        return diff !== 0 ? diff : a.length - b.length;
      });
      title = titleCase(related[0]);
    }

    // --- Description from the most descriptive for-sale listing title ---
    const candidates = [];
    scope.querySelectorAll("a[href]").forEach((a) => {
      if (!isMerchantAnchor(a)) return;
      const t = cleanText(a.innerText || a.textContent);
      if (t.length < 15 || t.length > 180) return;
      if (PRICE_EXACT_RE.test(t)) return;
      let host = "";
      try {
        host = new URL(a.href).hostname.toLowerCase();
      } catch (_) {
        /* keep host empty */
      }
      const isComp = COMP_SOURCES.some((s) => (host + " " + t.toLowerCase()).includes(s));
      candidates.push({ t, isComp });
    });

    let description = "";
    if (candidates.length) {
      // Prefer comp-source listings, then the longest (most descriptive) title.
      candidates.sort((a, b) => {
        if (a.isComp !== b.isComp) return a.isComp ? -1 : 1;
        return b.t.length - a.t.length;
      });
      description = candidates[0].t.replace(/[.\u2026]+$/, "").trim();
      if (description.length > 140) description = description.slice(0, 137).trim() + "…";
    }

    return { title, description };
  }

  function computeStats(prices) {
    if (!prices.length) return null;
    const values = prices.map((p) => p.value).sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2
        ? values[mid]
        : Math.round(((values[mid - 1] + values[mid]) / 2) * 100) / 100;
    return { min, median, max, count: values.length };
  }

  // Confidence tiers: "high" | "medium" | "low" | "none".
  // Signals: how many distinct prices, how tight the spread, and whether the
  // prices came from recognized comp sources (eBay, etc.).
  function scoreConfidence(prices, stats) {
    if (!prices.length || !stats) {
      return { confidence: "none", reason: "no prices found on the Lens results" };
    }

    const count = stats.count;
    const compCount = prices.filter((p) => p.source).length;
    const hasComps = compCount > 0;

    if (count === 1) {
      return {
        confidence: "low",
        reason: hasComps
          ? "only 1 price found (single comp source)"
          : "only 1 price found",
      };
    }

    // Relative spread: (max - min) / median. Tight cluster → confident.
    const spread = stats.median > 0 ? (stats.max - stats.min) / stats.median : Infinity;

    if (spread > 1.5) {
      return {
        confidence: "low",
        reason: `prices ranged widely ($${stats.min}–$${stats.max})`,
      };
    }

    if (count >= 3 && spread <= 0.6 && hasComps) {
      return {
        confidence: "high",
        reason: `${count} clustered prices from comp sources (e.g. ${prices.find((p) => p.source).source})`,
      };
    }

    if (count >= 2 && spread <= 1.0) {
      return {
        confidence: "medium",
        reason: hasComps
          ? `${count} prices from comp sources, moderate spread`
          : `${count} prices found, moderate spread`,
      };
    }

    return {
      confidence: "low",
      reason: `${count} prices with uncertain spread`,
    };
  }

  window.FlipLensExtractor = { extractPrices, pickPriceSet, computeStats, scoreConfidence, extractItemInfo };
})();
