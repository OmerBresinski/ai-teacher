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
    expect(WRITER_BUNDLE_ID).toBe("base4f-p125");
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

  for (const deployed of [
    { RAILWAY_ENVIRONMENT: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "production" },
    { RAILWAY_ENVIRONMENT_NAME: "staging", NODE_ENV: "test" },
    { RAILWAY_ENVIRONMENT: "pr-498" },
    { RAILWAY_PROJECT_ID: "p" }, // Railway with NODE_ENV unset
    { NODE_ENV: "production" },
  ]) {
    test(`ignored when deployed, with a warning (${JSON.stringify(deployed)})`, () => {
      const r = run({ ...deployed, LAB_PARITY: "1", LAB_WRITER_BUNDLE_ID: "base4g" });
      expect(r.id).toBe(WRITER_BUNDLE_ID);
      expect(r.warnings[0]).toContain("ignored outside the local lab");
    });
  }

  for (const marker of [undefined, "0", "true", " 1"]) {
    test(`ignored unless LAB_PARITY is exactly "1" (${String(marker)})`, () => {
      const r = run({ NODE_ENV: "test", LAB_PARITY: marker, LAB_WRITER_BUNDLE_ID: "base4g" });
      expect(r.id).toBe(WRITER_BUNDLE_ID);
      expect(r.warnings[0]).toContain("without LAB_PARITY=1");
    });
  }

  test("an unknown id in the lab throws rather than running production silently", () => {
    expect(() => run({ LAB_PARITY: "1", LAB_WRITER_BUNDLE_ID: "base9" })).toThrow(
      "not a writer bundle",
    );
  });
});
