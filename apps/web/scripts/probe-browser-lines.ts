// Regenerates `packages/slides/src/fixtures/browser-lines.json`: Chromium's line counts for bold and
// regular strings on 3 themes, set in the same @fontsource files the editor loads. Run from apps/web:
//   OUT=../../packages/slides/src/fixtures/browser-lines.json bun scripts/probe-browser-lines.ts
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const W = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const L = await import(`${W}/packages/slides/src/index.ts`);
const F = await import(`${W}/packages/slides/src/fonts.ts`);
const PKG: Record<string, string> = {
  lexend: "lexend",
  gabarito: "gabarito",
  figtree: "figtree",
  sourceSerif: "source-serif-4",
  schibsted: "schibsted-grotesk",
  literata: "literata",
  publicSans: "public-sans",
  bricolage: "bricolage-grotesque",
  instrumentSans: "instrument-sans",
  atkinson: "atkinson-hyperlegible-next",
  fredoka: "fredoka",
  playpen: "playpen-sans",
  baloo: "baloo-2",
  nunito: "nunito",
  outfit: "outfit",
};
const keyOf = (stack: string) =>
  Object.entries(F.FONT_STACKS).find(([, s]) => s === stack)?.[0] as string;
const STRINGS = [
  "Stresemann ended passive resistance in September.",
  "Production could restart, and payments to strikers ended.",
  "In November, the Rentenmark replaced worthless paper money for everyday use.",
  "Together with tighter government finances, these changes helped restore confidence and stabilise prices.",
  "Contemporary diary reports describe wages being spent quickly before prices rose again.",
  "Germany fell behind with deliveries of coal and timber.",
  "Why could hyperinflation harm a saver but help someone with a fixed debt in marks?",
  "A female chick grows into a hen.",
];
const WIDTHS = [416, 443, 520, 844];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body style='margin:0'></body></html>");
let bad = 0,
  n = 0;
const rows: unknown[] = [];
for (const id of (process.argv[2] ?? "studio,night-lab,chalk").split(",")) {
  const t = L.getTheme(id);
  const measure = L.measureHeadless(t);
  for (const preset of ["body", "heading"] as const) {
    const r = L.resolveTextStyle({ preset }, t);
    const key = keyOf(r.fontFamily);
    const file = `${W}/node_modules/.bun/@fontsource-variable+${PKG[key]}@5.3.0/node_modules/@fontsource-variable/${PKG[key]}/files/${PKG[key]}-latin-wght-normal.woff2`;
    const b64 = readFileSync(file).toString("base64");
    for (const weight of preset === "body" ? [400, 600, 700] : [r.fontWeight]) {
      for (const s of STRINGS)
        for (const w of WIDTHS) {
          const style = { preset, fontWeight: weight };
          const h = measure({
            doc: L.docFromText(s),
            width: w,
            style,
            preset,
            inset: 0,
            chrome: 0,
          });
          const rr = L.resolveTextStyle(style, t);
          const lh = rr.fontSize * rr.lineHeight;
          const mine = Math.round(h / lh);
          const real = await page.evaluate(
            async ({ key, b64, s, w, rr }) => {
              const w8 = window as unknown as { loaded?: Set<string> };
              w8.loaded ??= new Set();
              if (!w8.loaded.has(key)) {
                w8.loaded.add(key);
                const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                const face = new FontFace(`m-${key}`, bytes.buffer, { weight: "100 900" });
                await face.load();
                document.fonts.add(face);
              }
              const d = document.createElement("div");
              Object.assign(d.style, {
                width: `${w}px`,
                fontFamily: `"m-${key}"`,
                fontSize: `${rr.fontSize}px`,
                fontWeight: String(rr.fontWeight),
                lineHeight: String(rr.lineHeight),
                letterSpacing: rr.letterSpacing,
                whiteSpace: "pre-wrap",
                overflowWrap: "break-word",
              });
              d.textContent = s;
              document.body.appendChild(d);
              const lines = Math.round(
                d.getBoundingClientRect().height / (rr.fontSize * rr.lineHeight),
              );
              d.remove();
              return lines;
            },
            {
              key,
              b64,
              s,
              w,
              rr: {
                fontSize: rr.fontSize,
                fontWeight: rr.fontWeight,
                lineHeight: rr.lineHeight,
                letterSpacing: rr.letterSpacing,
              },
            },
          );
          n++;
          rows.push({ theme: id, preset, weight, width: w, text: s, lines: real });
          if (mine !== real) {
            bad++;
            console.log(
              `${id} ${preset} ${weight} ${key} w=${w} mine=${mine} real=${real} ls=${rr.letterSpacing} :: ${s.slice(0, 50)}`,
            );
          }
        }
    }
  }
}
console.log(`mismatches ${bad}/${n}`);
await browser.close();
if (process.env.OUT)
  (await import("node:fs")).writeFileSync(process.env.OUT, `${JSON.stringify(rows, null, 1)}\n`);
