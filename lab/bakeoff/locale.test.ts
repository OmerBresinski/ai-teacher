import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { ENGLAND, INDIA, locale, localise, setLocale } from "./locale";

// Round 8 (Greg): the prompts for an India brief carry no England framing and no en-GB locale.
const P =
  "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF/prompts";

describe("round 8: locale from the brief", () => {
  test("an India brief's prompts name India and never England or en-GB", () => {
    // Assemble the writer prompt fresh from its sources (as assemble.py does), then localise.
    const files = [
      ...["KS1", "KS2", "KS3-5"].map((st) => {
        const out = `${P}/../round8/logs/system.${st}.locale-test.txt`;
        execFileSync("python3", [`${P}/assemble.py`, "T", st, out], { cwd: P });
        return out;
      }),
      ...readdirSync(`${P}/shared`)
        .filter((f) => f.endsWith(".txt"))
        .map((f) => `${P}/shared/${f}`),
    ];
    for (const f of files) {
      const text = localise(readFileSync(f, "utf8"), INDIA);
      expect([f, /England|en-GB/.test(text)]).toEqual([f, false]);
      expect([f, /\{\{\s*locale\./.test(text)]).toEqual([f, false]);
    }
    const head = localise(readFileSync(`${P}/shared/base-head.txt`, "utf8"), INDIA);
    expect(head.split("\n")[0]).toContain("teacher in India");
  });
  test("the search locale and country follow the brief; rounds keep England", () => {
    setLocale(INDIA);
    expect(locale().spelling).toBe("en-IN");
    expect(locale().country).toBe("India");
    setLocale(undefined);
    expect(locale()).toEqual(ENGLAND);
    expect(localise("in {{locale.country}}")).toBe("in England");
  });
});
