import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createStorage, DEFAULT_STORAGE_ROOT } from "./create-storage";
import { LocalDiskStorage } from "./local-disk";
import { S3Storage } from "./s3";

const S3 = {
  S3_BUCKET: "files-test",
  S3_ENDPOINT: "https://s3.example",
  S3_ACCESS_KEY_ID: "tid_test",
  S3_SECRET_ACCESS_KEY: "tsec_test",
};

describe("createStorage", () => {
  test("no S3_BUCKET → local disk at STORAGE_ROOT ?? .data/storage", () => {
    const dflt = createStorage({});
    expect(dflt.kind).toBe("local-disk");
    expect(dflt.adapter).toBeInstanceOf(LocalDiskStorage);
    expect((dflt.adapter as LocalDiskStorage).rootDir).toBe(resolve(DEFAULT_STORAGE_ROOT));

    const custom = createStorage({
      STORAGE_ROOT: "/tmp/tj-files",
      STORAGE_PUBLIC_BASE_URL: "http://localhost:3000/dev-files/",
      S3_BUCKET: "   ",
    });
    expect(custom.kind).toBe("local-disk");
    const disk = custom.adapter as LocalDiskStorage;
    expect(disk.rootDir).toBe(resolve("/tmp/tj-files"));
    expect(disk.publicBaseUrl).toBe("http://localhost:3000/dev-files");
  });

  test("S3_BUCKET + credentials → S3Storage, STORAGE_* disk vars ignored", () => {
    const out = createStorage({ ...S3, STORAGE_ROOT: "/ignored", S3_REGION: " auto " });
    expect(out.kind).toBe("s3");
    expect(out.adapter).toBeInstanceOf(S3Storage);
  });

  test("S3_BUCKET without the other S3_* variables throws naming them", () => {
    expect(() => createStorage({ S3_BUCKET: "b" })).toThrow(
      "S3_BUCKET is set but S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY missing",
    );
    expect(() => createStorage({ ...S3, S3_SECRET_ACCESS_KEY: " " })).toThrow(
      "S3_SECRET_ACCESS_KEY missing",
    );
  });
});
