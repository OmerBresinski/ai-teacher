// Arm C: the lesson's CSS tokens (theme colours, fonts, key-stage type scale) from themes.ts, x2 for 1920.
import { CALLOUT_TONES, getTheme, typeScale } from "../../packages/slides/src/themes.ts";

export type Stage = "ks1" | "ks2" | "ks3" | "ks4" | "ks5";
export function stageOf(yearGroup: string): Stage {
  const y = Number(/(\d+)/.exec(yearGroup)?.[1] ?? 7);
  return y <= 2 ? "ks1" : y <= 6 ? "ks2" : y <= 9 ? "ks3" : y <= 11 ? "ks4" : "ks5";
}
export const themeOf = (ks: Stage) => (ks === "ks1" || ks === "ks2" ? "splash" : "studio");

export interface Tokens {
  themeId: string;
  ks: Stage;
  vars: Record<string, string>;
  minFont: number;
  fontsLink: string;
  fontFaces: string;
}

export function tokensFor(yearGroup: string): Tokens {
  const ks = stageOf(yearGroup);
  const themeId = themeOf(ks);
  const t: any = getTheme(themeId, ks);
  const s = typeScale(t)!;
  const c = t.colors;
  const lh = t.lineHeights ?? {};
  const px = (n: number) => `${n * 2}px`;
  const vars: Record<string, string> = {
    "--bg": c.background,
    "--surface": c.surface,
    "--ink": c.ink,
    "--heading": c.heading ?? c.ink,
    "--muted": c.muted,
    "--accent": c.accent,
    "--accent-2": c.accent2,
    "--on-accent": c.onAccent,
    "--line": c.line,
    "--correct": c.correct,
    "--incorrect": c.incorrect,
    "--font-title": t.fonts.title,
    "--font-body": t.fonts.body,
    "--fw-title": String(t.weights.title),
    "--fw-heading": String(t.weights.heading),
    "--fw-body": String(t.weights.body),
    "--tracking-title": t.titleTracking ?? "0em",
    "--radius": px(t.radius ?? 0),
    "--fs-title": px(s.title),
    "--fs-subtitle": px(s.subtitle),
    "--fs-heading-display": px(s.headingDisplay),
    "--fs-heading": px(s.heading),
    "--fs-body": px(s.body),
    "--fs-body-small": px(s.bodySmall),
    "--fs-caption": px(s.caption),
    "--lh-title": String(lh.title),
    "--lh-subtitle": String(lh.subtitle),
    "--lh-heading": String(lh.heading),
    "--lh-body": String(lh.body),
    "--lh-caption": String(lh.caption),
  };
  const tones = (CALLOUT_TONES as any)[themeId] ?? {};
  for (const [kind, tone] of Object.entries<any>(tones))
    for (const k of ["fill", "line", "ink", "icon"]) vars[`--${kind}-${k}`] = tone[k];
  const fontsLink = `<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;500;700;800&family=Outfit:wght@400;500;600;700;800&display=block" rel="stylesheet">`;
  const fontFaces = `--font-fredoka:"Fredoka";--font-nunito:"Nunito";--font-outfit:"Outfit";`;
  return { themeId, ks, vars, minFont: s.caption * 2, fontsLink, fontFaces };
}

/** The token table as the agent reads it ({{tokens}}). */
export const tokenTable = (tk: Tokens) =>
  Object.entries(tk.vars)
    .map(
      ([k, v]) =>
        `${k}: ${v.replace(/var\(--font-(\w+)\),?\s*/, (_, f) => `"${f[0].toUpperCase()}${f.slice(1)}", `)}`,
    )
    .join("\n");
