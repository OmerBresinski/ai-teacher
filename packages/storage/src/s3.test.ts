import { describe, expect, test } from "bun:test";
import { S3Storage } from "./s3";
import { runStorageContract } from "./storage-contract";

const env = {
  bucket: process.env.S3_BUCKET?.trim(),
  endpoint: process.env.S3_ENDPOINT?.trim(),
  accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim(),
  region: process.env.S3_REGION?.trim() || undefined,
};
const configured = Boolean(env.bucket && env.endpoint && env.accessKeyId && env.secretAccessKey);

// Contract run against a real bucket (the Railway Bucket `files` in CI / locally with
// `railway bucket credentials`). Objects are written under a fresh workspace id and removed by the
// suite's cleanup step. Skipped (with the reason) when the variables are not configured.
runStorageContract(
  "S3Storage",
  async () => ({
    adapter: new S3Storage({
      bucket: env.bucket ?? "",
      endpoint: env.endpoint ?? "",
      accessKeyId: env.accessKeyId ?? "",
      secretAccessKey: env.secretAccessKey ?? "",
      region: env.region,
    }),
  }),
  configured ? {} : { skip: "S3_BUCKET is not set" },
);

describe("S3Storage (offline)", () => {
  const full = {
    endpoint: "https://s3.example",
    bucket: "b",
    accessKeyId: "a",
    secretAccessKey: "s",
  };

  test("requires endpoint, bucket and both credentials", () => {
    expect(() => new S3Storage({ ...full, bucket: "" })).toThrow(/bucket/);
    expect(() => new S3Storage({ ...full, endpoint: "" })).toThrow(/endpoint/);
    expect(() => new S3Storage({ ...full, accessKeyId: "" })).toThrow(/accessKeyId/);
    expect(() => new S3Storage({ ...full, secretAccessKey: "" })).toThrow(/secretAccessKey/);
    expect(() => new S3Storage(full)).not.toThrow();
  });
});
