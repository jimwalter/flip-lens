// S3-compatible object store (AWS S3, Cloudflare R2, MinIO, ...).
// The AWS SDK is imported lazily so the local driver needs no S3 dependency at
// runtime. R2 is the recommended target at scale (zero egress fees); set
// S3_ENDPOINT to the R2 endpoint and S3_PUBLIC_BASE_URL to the CDN/public URL.
export async function createS3Store(cfg) {
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");

  if (!cfg.bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
  if (!cfg.publicBaseUrl) throw new Error("STORAGE_DRIVER=s3 requires S3_PUBLIC_BASE_URL");

  const client = new S3Client({
    region: cfg.region || "auto",
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: Boolean(cfg.endpoint),
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
  });

  return {
    driver: "s3",
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
      return { key, url: `${cfg.publicBaseUrl.replace(/\/$/, "")}/${key}` };
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}
