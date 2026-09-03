import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ID_SCHEMAS, type JobId, newId, type WorkspaceId } from "./ids";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("newId", () => {
  test("returns a valid UUID", () => {
    const id = newId();
    expect(id).toMatch(UUID_RE);
    expect(z.uuid().safeParse(id).success).toBe(true);
  });

  test("uses UUIDv7 under Bun (time-ordered)", () => {
    const id = newId();
    expect(id.charAt(14)).toBe("7");
    const a = newId();
    const b = newId();
    expect(a < b).toBe(true);
  });

  test("is unique across calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });

  test("browser fallback (crypto.randomUUID) yields a v4 UUID accepted by every schema", () => {
    // `Bun` is a non-writable global, so the branch cannot be toggled in-process; pin the
    // contract of the fallback instead.
    const id = crypto.randomUUID();
    expect(id).toMatch(UUID_RE);
    expect(id.charAt(14)).toBe("4");
    for (const schema of Object.values(ID_SCHEMAS)) {
      expect(schema.safeParse(id).success).toBe(true);
    }
  });

  test("brand is inferred from the annotation or the type argument", () => {
    const ws: WorkspaceId = newId();
    const job = newId<JobId>();
    expect(ID_SCHEMAS.WorkspaceId.parse(ws)).toBe(ws);
    expect(ID_SCHEMAS.JobId.parse(job)).toBe(job);
  });

  test.each(Object.entries(ID_SCHEMAS))("parses as %s", (_brand, schema) => {
    const id = newId();
    const result = schema.safeParse(id);
    expect(result.success).toBe(true);
    if (result.success) expect(String(result.data)).toBe(id);
  });
});

describe("branded id schemas", () => {
  test.each(Object.entries(ID_SCHEMAS))("%s rejects non-UUID strings", (brand, schema) => {
    for (const bad of ["", "not-a-uuid", "1234", "00000000-0000-0000-0000-00000000000g"]) {
      const result = schema.safeParse(bad);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toContain(brand);
    }
  });

  test("accept both v4 and v7 UUIDs", () => {
    const v4 = crypto.randomUUID();
    const v7 = Bun.randomUUIDv7();
    expect(ID_SCHEMAS.UserId.safeParse(v4).success).toBe(true);
    expect(ID_SCHEMAS.UserId.safeParse(v7).success).toBe(true);
  });
});
