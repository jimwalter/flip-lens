import { query } from "../db.js";

// Every method is scoped by tenant_id + user_id. This is the single layer that
// enforces tenant isolation today; RLS can be layered on later (see 001_init.sql).

const COLUMNS = `
  id, tenant_id, user_id, created_at, updated_at,
  thumbnail_key, thumbnail_url, source_url, lens_url,
  title, description, resale_value, confidence, confidence_reason,
  user_confirmed, price_stats, market_stats, comps
`;

function rowToItem(r) {
  if (!r) return null;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    thumbnailKey: r.thumbnail_key,
    thumbnailUrl: r.thumbnail_url,
    sourceUrl: r.source_url,
    lensUrl: r.lens_url,
    title: r.title,
    description: r.description,
    resaleValue: r.resale_value === null ? null : Number(r.resale_value),
    confidence: r.confidence,
    confidenceReason: r.confidence_reason,
    userConfirmed: r.user_confirmed,
    priceStats: r.price_stats,
    marketStats: r.market_stats,
    comps: r.comps,
  };
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

// Keyset (cursor) pagination ordered by (created_at desc, id desc). A cursor
// encodes the last row's sort key, so the query stays O(log n) on the
// (tenant_id, user_id, created_at desc) index regardless of history size —
// unlike OFFSET, which scans and discards skipped rows.
function encodeCursor(row) {
  const raw = JSON.stringify({ c: row.created_at.toISOString(), i: row.id });
  return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const { c, i } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof c !== "string" || typeof i !== "string") return null;
    if (Number.isNaN(Date.parse(c))) return null;
    return { createdAt: c, id: i };
  } catch {
    return null;
  }
}

export async function listItems({ tenantId, userId, limit, cursor } = {}) {
  const pageSize = Math.min(
    Math.max(Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );

  const params = [tenantId, userId];
  let keyset = "";
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) {
      const err = new Error("invalid_cursor");
      err.status = 400;
      throw err;
    }
    params.push(decoded.createdAt, decoded.id);
    keyset = `and (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(pageSize + 1); // fetch one extra to detect another page

  const { rows } = await query(
    `select ${COLUMNS} from items
       where tenant_id = $1 and user_id = $2 ${keyset}
       order by created_at desc, id desc
       limit $${params.length}`,
    params
  );

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  return {
    items: page.map(rowToItem),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}

export async function getItem({ tenantId, userId, id }) {
  const { rows } = await query(
    `select ${COLUMNS} from items
       where tenant_id = $1 and user_id = $2 and id = $3`,
    [tenantId, userId, id]
  );
  return rowToItem(rows[0]);
}

export async function createItem({ tenantId, userId, data }) {
  const { rows } = await query(
    `insert into items (
       tenant_id, user_id, thumbnail_key, thumbnail_url, source_url, lens_url,
       title, description, resale_value, confidence, confidence_reason,
       user_confirmed, price_stats, market_stats, comps
     ) values (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
     )
     returning ${COLUMNS}`,
    [
      tenantId,
      userId,
      data.thumbnailKey ?? null,
      data.thumbnailUrl ?? null,
      data.sourceUrl ?? null,
      data.lensUrl ?? null,
      data.title ?? "",
      data.description ?? "",
      data.resaleValue ?? null,
      data.confidence ?? "none",
      data.confidenceReason ?? "",
      data.userConfirmed ?? false,
      data.priceStats ?? null,
      data.marketStats ?? null,
      JSON.stringify(Array.isArray(data.comps) ? data.comps : []),
    ]
  );
  return rowToItem(rows[0]);
}

// Whitelisted, partial update. Unknown keys are ignored.
const UPDATABLE = {
  title: "title",
  description: "description",
  resaleValue: "resale_value",
  confidence: "confidence",
  confidenceReason: "confidence_reason",
  userConfirmed: "user_confirmed",
  thumbnailKey: "thumbnail_key",
  thumbnailUrl: "thumbnail_url",
  sourceUrl: "source_url",
  lensUrl: "lens_url",
  priceStats: "price_stats",
  marketStats: "market_stats",
  comps: "comps",
};

export async function updateItem({ tenantId, userId, id, patch }) {
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (!(key in patch)) continue;
    let val = patch[key];
    if (key === "comps") val = JSON.stringify(Array.isArray(val) ? val : []);
    sets.push(`${col} = $${i++}`);
    values.push(val);
  }
  if (!sets.length) {
    return getItem({ tenantId, userId, id });
  }
  sets.push(`updated_at = now()`);
  values.push(tenantId, userId, id);
  const { rows } = await query(
    `update items set ${sets.join(", ")}
       where tenant_id = $${i++} and user_id = $${i++} and id = $${i}
       returning ${COLUMNS}`,
    values
  );
  return rowToItem(rows[0]);
}

export async function deleteItem({ tenantId, userId, id }) {
  const { rows } = await query(
    `delete from items
       where tenant_id = $1 and user_id = $2 and id = $3
       returning thumbnail_key`,
    [tenantId, userId, id]
  );
  return rows[0] ? { thumbnailKey: rows[0].thumbnail_key } : null;
}
