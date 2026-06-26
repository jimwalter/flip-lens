import { config } from "./config.js";
import { createApp } from "./app.js";
import { createObjectStore } from "./storage/index.js";
import { closePool } from "./db.js";

async function main() {
  const store = await createObjectStore();
  const app = createApp(store);

  const server = app.listen(config.port, () => {
    console.log(`flip-lens API listening on :${config.port} (storage=${store.driver})`);
  });

  const shutdown = async () => {
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
