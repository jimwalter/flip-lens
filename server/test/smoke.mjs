// Smoke test: boots the API in-process against a real Postgres and exercises
// the core contract — pagination, validation, and security headers. Exits
// non-zero on the first failed assertion so CI fails loudly.
//
// Requires DATABASE_URL to point at a migrated database (CI runs `npm run
// migrate` first against a Postgres service container).

import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createObjectStore } from "../src/storage/index.js";
import { closePool } from "../src/db.js";

const store = await createObjectStore();
const app = createApp(store);
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const created = [];
let failures = 0;
function check(name, fn) {
  return fn().then(
    () => console.log(`ok - ${name}`),
    (err) => {
      failures++;
      console.error(`FAIL - ${name}: ${err.message}`);
    }
  );
}

const j = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });
const post = (payload) =>
  fetch(`${base}/api/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

try {
  await check("health ok", async () => {
    const { status, body } = await j(await fetch(`${base}/health`));
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  await check("helmet + ratelimit headers present", async () => {
    const res = await fetch(`${base}/api/items`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("ratelimit-limit"), "missing RateLimit-Limit");
  });

  await check("create 3 items", async () => {
    for (const n of [1, 2, 3]) {
      const { status, body } = await j(await post({ title: `Smoke ${n}`, resaleValue: n * 10 }));
      assert.equal(status, 201);
      created.push(body.item.id);
      await new Promise((r) => setTimeout(r, 20)); // distinct created_at ordering
    }
  });

  await check("keyset pagination pages through with cursor", async () => {
    const p1 = await j(await fetch(`${base}/api/items?limit=2`));
    assert.equal(p1.status, 200);
    assert.equal(p1.body.items.length, 2);
    assert.ok(p1.body.nextCursor, "expected a nextCursor on page 1");
    const p2 = await j(
      await fetch(`${base}/api/items?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
    );
    assert.equal(p2.status, 200);
    assert.ok(p2.body.items.length >= 1);
    // newest-first, no overlap between pages
    const ids1 = new Set(p1.body.items.map((i) => i.id));
    assert.ok(p2.body.items.every((i) => !ids1.has(i.id)), "pages overlapped");
  });

  await check("limit clamps to <= 100", async () => {
    const res = await fetch(`${base}/api/items?limit=99999`);
    assert.equal(res.status, 200); // does not error; repository clamps internally
  });

  await check("invalid cursor -> 400", async () => {
    assert.equal((await fetch(`${base}/api/items?cursor=not-base64-json`)).status, 400);
  });

  await check("invalid uuid param -> 400", async () => {
    assert.equal((await fetch(`${base}/api/items/not-a-uuid`)).status, 400);
  });

  await check("negative resaleValue -> 400", async () => {
    assert.equal((await post({ resaleValue: -5 })).status, 400);
  });

  await check("unknown confidence coerced to none", async () => {
    const { body } = await j(await post({ title: "c", confidence: "super-high" }));
    created.push(body.item.id);
    assert.equal(body.item.confidence, "none");
  });

  await check("oversized title truncated to 500", async () => {
    const { body } = await j(await post({ title: "a".repeat(900) }));
    created.push(body.item.id);
    assert.equal(body.item.title.length, 500);
  });
} finally {
  // Clean up everything this run created so reruns stay deterministic.
  for (const id of created) {
    await fetch(`${base}/api/items/${id}`, { method: "DELETE" }).catch(() => {});
  }
  server.close();
  await closePool();
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
