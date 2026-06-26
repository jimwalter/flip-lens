import "dotenv/config";

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

const port = Number(process.env.PORT || 8787);

export const config = {
  port,
  corsOrigins: (process.env.CORS_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  databaseUrl: required("DATABASE_URL", "postgres://flip:flip@localhost:5432/flip_lens"),
  defaultTenantId: process.env.DEFAULT_TENANT_ID || "00000000-0000-0000-0000-000000000001",
  defaultUserId: process.env.DEFAULT_USER_ID || "00000000-0000-0000-0000-000000000001",
  storage: {
    driver: process.env.STORAGE_DRIVER || "local",
    localDir: process.env.STORAGE_LOCAL_DIR || "./.data/images",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${port}/images`,
    s3: {
      bucket: process.env.S3_BUCKET || "",
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || "",
    },
  },
};
