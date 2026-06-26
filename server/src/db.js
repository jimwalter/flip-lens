import pg from "pg";
import { config } from "./config.js";

// A single shared pool. Every query is scoped by tenant_id + user_id at the
// repository layer (see repositories/itemRepository.js). When auth lands, the
// only change is where req.tenantId / req.userId come from — not the queries.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export function query(text, params) {
  return pool.query(text, params);
}

export async function closePool() {
  await pool.end();
}
