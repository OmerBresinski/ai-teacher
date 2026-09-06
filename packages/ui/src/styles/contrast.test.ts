import { describe, expect, it } from "bun:test";

/**
 * WCAG contrast over the shipped tokens (ports TeachDeck `contrast.test.ts`). Values are read
 * from `globals.css` so a token edit that breaks a pair fails here before it reaches axe in e2e.
 */
const css = await Bun.file(new URL("./globals.css", import.meta.url)).text();

function blockFor(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing selector: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  throw new Error(`Unclosed selector: ${selector}`);
}

type Theme = "light" | "dark" | "high-contrast";
const BLOCKS: Record<Theme, string> = {
  light: blockFor(":root {"),
  dark: blockFor('[data-theme="dark"] {'),
  "high-contrast": blockFor('[data-theme="high-contrast"] {'),
};

/** Resolve `--name` in a theme block, following `var(--other)` and falling back to `:root`. */
export function token(theme: Theme, name: string, depth = 0): string {
  if (depth > 5) throw new Error(`Cyclic token: ${name}`);
  const block = BLOCKS[theme];
  const match =
    block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`)) ??
    BLOCKS.light.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`Missing token ${name} in ${theme}`);
  const value = match[1].replace(/\/\*.*?\*\//g, "").trim();
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/);
  return alias?.[1] ? token(theme, alias[1], depth + 1) : value;
}

function channel(hex: string): number[] {
  const short = hex.length === 4;
  const parts = short
    ? [hex[1], hex[2], hex[3]].map((c) => Number.parseInt(`${c}${c}`, 16))
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => Number.parseInt(c, 16));
  return parts.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
}

function luminance(hex: string): number {
  const [r, g, b] = channel(hex) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const THEMES: Theme[] = ["light", "dark", "high-contrast"];
const TEXT_PAIRS: [string, string][] = [
  ["--foreground", "--background"],
  ["--foreground", "--card"],
  ["--ink-2", "--background"],
  ["--ink-2", "--card"],
  ["--ink-3", "--card"],
  ["--ink-3", "--background"],
  ["--brand-text", "--background"],
  ["--brand-text", "--card"],
  ["--destructive", "--background"],
  ["--destructive-foreground", "--destructive"],
  ["--success", "--background"],
  ["--warning", "--background"],
  ["--primary-foreground", "--primary-fill-aa"],
  ["--card-foreground", "--card"],
  ["--muted-foreground", "--muted"],
  ["--secondary-foreground", "--secondary"],
];
const CONTROL_PAIRS: [string, string][] = [
  ["--border-control", "--background"],
  ["--border-control", "--card"],
  ["--primary", "--background"],
];

describe("token contrast", () => {
  for (const theme of THEMES) {
    const minimum = theme === "high-contrast" ? 7 : 4.5;

    it(`${theme}: every text pair clears ${minimum}:1`, () => {
      const failures = TEXT_PAIRS.flatMap(([fg, bg]) => {
        const ratio = contrast(token(theme, fg), token(theme, bg));
        return ratio < minimum ? [`${fg} on ${bg} = ${ratio.toFixed(2)}`] : [];
      });
      expect(failures).toEqual([]);
    });

    it(`${theme}: control boundaries and the brand hue clear 3:1 as non-text`, () => {
      const failures = CONTROL_PAIRS.flatMap(([fg, bg]) => {
        const ratio = contrast(token(theme, fg), token(theme, bg));
        return ratio < 3 ? [`${fg} on ${bg} = ${ratio.toFixed(2)}`] : [];
      });
      expect(failures).toEqual([]);
    });
  }

  it("light: filled primary is the recorded 3.71:1 exception, not something worse", () => {
    // ADR 0019 §4 (amended 2026-09-06): white on TeachDeck terracotta, by decision. If the fill
    // drifts darker this still passes; if it drifts lighter than the decision, this fails.
    const ratio = contrast(
      token("light", "--primary-foreground"),
      token("light", "--primary-fill"),
    );
    expect(ratio).toBeGreaterThanOrEqual(3.7);
  });

  it("dark and high-contrast: filled primary meets AA without the exception", () => {
    for (const theme of ["dark", "high-contrast"] as const) {
      const ratio = contrast(token(theme, "--primary-foreground"), token(theme, "--primary-fill"));
      expect(ratio).toBeGreaterThanOrEqual(theme === "dark" ? 4.5 : 7);
    }
  });

  describe("stage scope (ADR 0022 §3)", () => {
    const stage = blockFor(".tj-stage {");
    const stageToken = (name: string): string => {
      const match = stage.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
      if (!match?.[1]) throw new Error(`Missing stage token ${name}`);
      return match[1].replace(/\/\*.*?\*\//g, "").trim();
    };
    const STAGE_TEXT: [string, string][] = [
      ["--foreground", "--card"],
      ["--foreground", "--background"],
      ["--muted-foreground", "--background"],
      ["--muted-foreground", "--card"],
      ["--secondary-foreground", "--secondary"],
      ["--muted-foreground", "--secondary"],
      ["--brand-text", "--background"],
      ["--destructive", "--card"],
      ["--destructive-foreground", "--destructive"],
      ["--success", "--background"],
      ["--warning", "--background"],
    ];

    it("every text pair clears 4.5:1 on the stage", () => {
      const failures = STAGE_TEXT.flatMap(([fg, bg]) => {
        const ratio = contrast(stageToken(fg), stageToken(bg));
        return ratio < 4.5 ? [`${fg} on ${bg} = ${ratio.toFixed(2)}`] : [];
      });
      expect(failures).toEqual([]);
    });

    it("control boundaries and the accent clear 3:1 on the stage", () => {
      for (const bg of ["--background", "--card", "--secondary"]) {
        expect(contrast(stageToken("--border-control"), stageToken(bg))).toBeGreaterThanOrEqual(3);
        expect(contrast(stageToken("--primary"), stageToken(bg))).toBeGreaterThanOrEqual(3);
      }
    });

    it("checked controls keep the recorded white-on-terracotta fill (ADR 0019 §4)", () => {
      expect(stageToken("--primary-fill-aa")).toBe(stageToken("--primary-fill"));
      expect(stageToken("--primary-foreground")).toBe("#ffffff");
      expect(
        contrast(stageToken("--primary-foreground"), stageToken("--primary-fill-aa")),
      ).toBeGreaterThanOrEqual(3.7);
    });

    it("paints no ground of its own", () => {
      expect(stage).not.toMatch(/^\s*background\s*:/m);
      expect(stage).not.toMatch(/^\s*color\s*:/m);
    });
  });

  it("the helper agrees with the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });
});
