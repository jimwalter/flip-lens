import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Dev/default object store. Writes bytes to a local directory and serves them
// back via GET /images/:key (see routes/images.js). Swap STORAGE_DRIVER=s3 for
// production object storage — same interface.
export function createLocalDiskStore({ dir, publicBaseUrl }) {
  const root = resolve(dir);

  return {
    driver: "local",
    async put(key, body /* Buffer */, _contentType) {
      const dest = join(root, key);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
      return {
        key,
        url: `${publicBaseUrl.replace(/\/$/, "")}/${key}`,
      };
    },
    async delete(key) {
      try {
        await unlink(join(root, key));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    },
    localRoot: root,
  };
}
