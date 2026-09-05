import { describe, expect, it } from "bun:test";

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

function variables(block: string): string[] {
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

const rootOnlyGeometry = new Set([
  "--sidebar-width",
  "--sidebar-width-collapsed",
  "--tile-height",
  "--pill-height",
]);

function paletteVariables(block: string): string[] {
  return variables(block).filter((name) => !rootOnlyGeometry.has(name));
}

describe("TeachDeck globals", () => {
  it("defines all three resolved theme blocks", () => {
    expect(css).toContain(":root {");
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('[data-theme="high-contrast"] {');
    expect(css).toContain("html:not([data-theme]) {");
  });

  it("keeps the explicit themes and OS dark mirror in sync", () => {
    const light = paletteVariables(blockFor(":root {"));
    const dark = paletteVariables(blockFor('[data-theme="dark"] {'));
    const systemDark = paletteVariables(blockFor("html:not([data-theme]) {"));
    const highContrast = paletteVariables(blockFor('[data-theme="high-contrast"] {'));

    expect(dark).toEqual(light);
    expect(systemDark).toEqual(dark);
    expect(highContrast).toEqual(light);
  });

  it("keeps component geometry root-only", () => {
    const root = variables(blockFor(":root {"));
    for (const variable of rootOnlyGeometry) expect(root).toContain(variable);
  });

  it("does not retain the retired palette tokens", () => {
    const retiredStatusPrefix = ["--status", "-"].join("");
    const retiredSurfaceToken = ["--", "surface"].join("");

    expect(css).not.toContain(retiredStatusPrefix);
    expect(css).not.toContain(retiredSurfaceToken);
  });

  it("maps every required utility through the Tailwind theme", () => {
    const theme = blockFor("@theme inline {");
    for (const token of [
      "--radius-chip",
      "--radius-control",
      "--radius-card",
      "--radius-dialog",
      "--radius-face",
      "--text-lead",
      "--text-meta",
      "--font-display",
      "--shadow-2",
      "--color-ink-3",
      "--color-brand-tint",
      "--color-brand-text",
      "--color-scrim",
    ]) {
      expect(theme).toContain(token);
    }
  });
});
