import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createStorage, DEFAULT_STORAGE_ROOT } from "./create-storage";
import { LocalDiskStorage } from "./local-disk";
import { VercelBlobStorage } from "./vercel-blob";

describe("createStorage", () => {
  test("no token → local disk at STORAGE_ROOT ?? .data/storage", () => {
    const dflt = createStorage({});
    expect(dflt.kind).toBe("local-disk");
    expect(dflt.adapter).toBeInstanceOf(LocalDiskStorage);
    expect((dflt.adapter as LocalDiskStorage).rootDir).toBe(resolve(DEFAULT_STORAGE_ROOT));

    const custom = createStorage({
      STORAGE_ROOT: "/tmp/tj-files",
      STORAGE_PUBLIC_BASE_URL: "http://localhost:3000/dev-files/",
      BLOB_READ_WRITE_TOKEN: "   ",
    });
    expect(custom.kind).toBe("local-disk");
    const disk = custom.adapter as LocalDiskStorage;
    expect(disk.rootDir).toBe(resolve("/tmp/tj-files"));
    expect(disk.publicBaseUrl).toBe("http://localhost:3000/dev-files");
  });

  test("token → Vercel Blob, STORAGE_* disk vars ignored, public prefixes parsed", () => {
    const ws = "0b8b6f4e-4b6c-4f6e-9d3e-8b6e1c2d3f4a";
    const out = createStorage({
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
      STORAGE_ROOT: "/ignored",
      STORAGE_PUBLIC_PREFIXES: ` ${ws}/public , ${ws}/assets/ `,
    });
    expect(out.kind).toBe("vercel-blob");
    expect(out.adapter).toBeInstanceOf(VercelBlobStorage);
    const blob = out.adapter as VercelBlobStorage;
    expect(blob.isPublic(`${ws}/public/logo.png`)).toBe(true);
    expect(blob.isPublic(`${ws}/assets/x.png`)).toBe(true);
    expect(blob.isPublic(`${ws}/public-old/x.png`)).toBe(false);
    expect(blob.isPublic(`${ws}/sources/x.pdf`)).toBe(false);
  });
});
