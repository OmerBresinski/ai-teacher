import { describe, expect, test } from "bun:test";
import {
  ACTIVE_WRITER_BUNDLE_ID,
  resolveWriterBundleId,
  WRITER_BUNDLE_ID,
  writerBundle,
} from "./bundle";

/*
 * The parity lab's one declared candidate (Greg, 11 Oct): LAB_WRITER_BUNDLE_ID picks the writer
 * bundle only in the lab (LAB_PARITY=1) and never under a production signal.
 */
const run = (env: Record<string, string | undefined>) => {
  const warnings: string[] = [];
  const id = resolveWriterBundleId(env, (m) => warnings.push(m));
  return { id, warnings };
};

describe("LAB_WRITER_BUNDLE_ID", () => {
  test("production constant is unchanged and is what this test process runs", () => {
    expect(WRITER_BUNDLE_ID).toBe("base4f-p123");
    expect(ACTIVE_WRITER_BUNDLE_ID).toBe(WRITER_BUNDLE_ID);
    expect(writerBundle().id).toBe(WRITER_BUNDLE_ID);
  });

  test("unset: the production bundle, no warning", () => {
    expect(run({ LAB_PARITY: "1" })).toEqual({ id: WRITER_BUNDLE_ID, warnings: [] });
  });

  test("the lab honours it", () => {
    const r = run({ LAB_PARITY: "1", NODE_ENV: "test", LAB_WRITER_BUNDLE_ID: "base4g" });
    expect(r.id).toBe("base4g");
    expect(r.warnings[0]).toContain("lab candidate");
  });

  for (const prod of [
    { RAILWAY_ENVIRONMENT: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { NODE_ENV: "production" },
  ]) {
    test(`production ignores it, with a warning (${Object.keys(prod)[0]})`, () => {
      const r = run({ ...prod, LAB_PARITY: "1", LAB_WRITER_BUNDLE_ID: "base4g" });
      expect(r.id).toBe(WRITER_BUNDLE_ID);
      expect(r.warnings[0]).toContain("ignored in production");
    });
  }

  test("ignored without the lab marker", () => {
    const r = run({ NODE_ENV: "test", LAB_WRITER_BUNDLE_ID: "base4g" });
    expect(r.id).toBe(WRITER_BUNDLE_ID);
    expect(r.warnings[0]).toContain("without LAB_PARITY=1");
  });

  test("an unknown id in the lab throws rather than running production silently", () => {
    expect(() => run({ LAB_PARITY: "1", LAB_WRITER_BUNDLE_ID: "base9" })).toThrow(
      "not a writer bundle",
    );
  });
});
