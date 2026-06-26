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

  // Matches "$1,234.56", "$99", "$1.2k" is intentionally NOT matched to avoid
  // garbage. Currency limited to USD for the MVP.
  const PRICE_RE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;

  // Candidate containers for shopping / for-sale match listings. Lens markup
  // changes often, so we try several broad selectors and de-duplicate.
  const LISTING_SELECTORS = [
    'a[href*="shopping"]',
    'a[href*="/url?"]',
    '[role="listitem"]',
    'div[data-item-id]',
    'div[jsname]',
  ];

  function parsePrice(str) {
    const num = parseFloat(str.replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : null;
  }

  // Walk likely listing nodes and pull price strings + a guess at their source.
  // Returns: [{ value:Number, source:String|null, text:String }]
  function extractPrices(root = document) {
    const found = [];
    const seenNodes = new Set();

    const nodes = [];
    for (const sel of LISTING_SELECTORS) {
      root.querySelectorAll(sel).forEach((n) => nodes.push(n));
    }

    for (const node of nodes) {
      if (seenNodes.has(node)) continue;
      seenNodes.add(node);

      const text = (node.innerText || node.textContent || "").trim();
      if (!text) continue;

      const matches = text.match(PRICE_RE);
      if (!matches) continue;

      const lower = text.toLowerCase();
      const href = (node.getAttribute && (node.getAttribute("href") || "")) || "";
      const haystack = (lower + " " + href.toLowerCase());
      const source = COMP_SOURCES.find((s) => haystack.includes(s)) || null;

      for (const m of matches) {
        const value = parsePrice(m);
        // Filter implausible values (Lens UI chrome, ratings, etc.).
        if (value == null || value < 1 || value > 100000) continue;
        found.push({ value, source, text: text.slice(0, 120) });
      }
    }

    // De-duplicate identical value+source pairs (same listing matched twice).
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

  window.FlipLensExtractor = { extractPrices, computeStats, scoreConfidence };
})();
