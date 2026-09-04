import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { runStorageContract } from "./storage-contract";
import { VercelBlobStorage } from "./vercel-blob";

const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

// Contract run against a real Blob store. Objects are written under a fresh workspace id and
// removed by the suite's cleanup step. Skipped (with the reason) when no token is configured.
runStorageContract(
  "VercelBlobStorage",
  async () => ({ adapter: new VercelBlobStorage({ token: token ?? "" }) }),
  token ? {} : { skip: "BLOB_READ_WRITE_TOKEN is not set" },
);

describe("VercelBlobStorage (offline)", () => {
  test("requires a token", () => {
    expect(() => new VercelBlobStorage({ token: "" })).toThrow();
  });

  test("public prefixes use path-style matching", () => {
    const ws = newId<WorkspaceId>();
    const storage = new VercelBlobStorage({ token: "x", publicPrefixes: [`${ws}/pub`] });
    expect(storage.isPublic(`${ws}/pub/a.png`)).toBe(true);
    expect(storage.isPublic(`${ws}/pub`)).toBe(true);
    expect(storage.isPublic(`${ws}/pub-old/a.png`)).toBe(false);
    expect(storage.isPublic(`${newId<WorkspaceId>()}/pub/a.png`)).toBe(false);
  });

  test("invalid public prefixes are rejected at construction", () => {
    expect(() => new VercelBlobStorage({ token: "x", publicPrefixes: ["../x"] })).toThrow();
  });
});
