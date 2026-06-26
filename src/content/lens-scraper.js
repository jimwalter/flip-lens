// Flip Lens — Google Lens results scraper (orchestration only).
//
// Injected by the background worker into the Lens results page (which Google
// currently serves from www.google.com/search?udm=26). Asks the background
// worker whether this tab is associated with a pending history entry; if so,
// watches the page with a
// MutationObserver until shopping/for-sale results render (or a timeout fires),
// then uses the FlipLensExtractor module to pull prices + a confidence score
// and reports them back.
//
// All DOM-specific logic lives in lens-extractor.js so this file rarely needs
// changes when Google updates its markup. The whole thing is wrapped in
// try/catch so a scraper failure never breaks the user's manual flow.

(() => {
  const TIMEOUT_MS = 12000;
  const SETTLE_MS = 1500; // wait a beat after results appear for late prices

  async function start() {
    let job;
    try {
      job = await chrome.runtime.sendMessage({ type: "FLIPLENS_GET_SCRAPE_JOB" });
    } catch (e) {
      return; // background unavailable; nothing to do
    }
    if (!job || !job.entryId) return; // this Lens tab isn't ours

    const entryId = job.entryId;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(timer);
      runScrape(entryId);
    };

    // Re-scrape shortly after the DOM stops mutating (results have rendered).
    let settleTimer = null;
    const observer = new MutationObserver(() => {
      try {
        const extractor = window.FlipLensExtractor;
        if (!extractor) return;
        const prices = extractor.extractPrices(document);
        if (prices.length > 0) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, SETTLE_MS);
        }
      } catch (_) {
        /* ignore; timeout will still fire */
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Hard timeout — report whatever we have (possibly nothing → "none").
    const timer = setTimeout(finish, TIMEOUT_MS);
  }

  function runScrape(entryId) {
    let payload = { confidence: "none", confidenceReason: "scrape unavailable", stats: null };
    try {
      const extractor = window.FlipLensExtractor;
      if (extractor) {
        const all = extractor.extractPrices(document);
        const prices = extractor.pickPriceSet(all);
        const stats = extractor.computeStats(prices);
        const { confidence, reason } = extractor.scoreConfidence(prices, stats);
        payload = { stats, confidence, confidenceReason: reason };
      }
    } catch (e) {
      console.warn("Flip Lens: scrape failed (non-fatal):", e);
    }

    chrome.runtime
      .sendMessage({ type: "FLIPLENS_SCRAPE_RESULT", entryId, ...payload })
      .catch(() => {});
  }

  try {
    start();
  } catch (e) {
    console.warn("Flip Lens: scraper init failed (non-fatal):", e);
  }
})();
