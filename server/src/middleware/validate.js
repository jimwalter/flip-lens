// Input validation / sanitization for item requests.
//
// SQL injection is already prevented at the data layer (all queries are
// parameterized and update columns come from a fixed whitelist). This layer is
// defense-in-depth: it rejects malformed IDs early and coerces/limits incoming
// field values so a client can't store oversized or wrong-typed data.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIMITS = {
  title: 500,
  description: 5000,
  confidence: 32,
  confidenceReason: 1000,
  sourceUrl: 2048,
  lensUrl: 2048,
};

const CONFIDENCE_TIERS = new Set(["high", "medium", "low", "none"]);

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function assertUuid(id) {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw badRequest("invalid_id");
  }
}

function str(value, max) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

// Returns a clean object of storable fields. `partial` keeps only keys present
// in the body (for PATCH); otherwise every field is present (for POST defaults).
export function sanitizeItemFields(body, { partial = false } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  const want = (k) => !partial || has(k);

  if (want("title")) out.title = str(src.title, LIMITS.title);
  if (want("description")) out.description = str(src.description, LIMITS.description);
  if (want("confidenceReason")) out.confidenceReason = str(src.confidenceReason, LIMITS.confidenceReason);
  if (want("sourceUrl")) out.sourceUrl = str(src.sourceUrl, LIMITS.sourceUrl);
  if (want("lensUrl")) out.lensUrl = str(src.lensUrl, LIMITS.lensUrl);

  if (want("confidence")) {
    const c = str(src.confidence, LIMITS.confidence);
    out.confidence = CONFIDENCE_TIERS.has(c) ? c : "none";
  }

  if (want("resaleValue")) {
    if (src.resaleValue === null || src.resaleValue === undefined || src.resaleValue === "") {
      out.resaleValue = null;
    } else {
      const n = Number(src.resaleValue);
      if (!Number.isFinite(n) || n < 0) throw badRequest("invalid_resale_value");
      out.resaleValue = n;
    }
  }

  if (want("userConfirmed")) out.userConfirmed = Boolean(src.userConfirmed);

  if (want("priceStats")) out.priceStats = isPlainObject(src.priceStats) ? src.priceStats : null;
  if (want("marketStats")) out.marketStats = isPlainObject(src.marketStats) ? src.marketStats : null;

  if (want("comps")) {
    if (src.comps === undefined || src.comps === null) {
      out.comps = [];
    } else if (Array.isArray(src.comps)) {
      out.comps = src.comps.slice(0, 100);
    } else {
      throw badRequest("invalid_comps");
    }
  }

  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
