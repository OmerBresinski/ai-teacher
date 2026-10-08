// polish arm (9 Oct, rootcause/uk-seasons.md): base4 + code fixes only. Writer prompt and schema
// files are base4's until the prompt-engineer's wording (arms3/polish/REQUEST.md) lands and is pinned.
//  1. The title's subtitle is code's (year and subject), never the writer's lead (24/24 base4 leads
//     were the recall prompt of the flow's slide 1).
//  2-3. Renderer: packages/slides/src/diagrams/polish.ts (snug nodes, label gap gate, strips kind).
//  4. The picture judge sees 768 px candidates (detail high); a contrast and haze gate drops
//     washed-out stock candidates before the judge.
//  5. Per-stage picture timings and the cause of a slot that ends with no picture (services.ts).
import { readFileSync } from "node:fs";
// Transitive dependencies already installed (no package.json change in a shared worktree).
import UPNG from "../../../node_modules/.bun/@pdf-lib+upng@1.0.1/node_modules/@pdf-lib/upng/UPNG.js";
import jpeg from "../../../node_modules/.bun/jpeg-js@0.4.4/node_modules/jpeg-js/index.js";

/** Code's title subtitle: the brief's year and subject, as the code title already shows it. */
export function polishTitleLead(brief: { yearGroup: string; subject: string }): string {
  return `${brief.yearGroup} ${brief.subject}`.trim();
}

/** A recall or task prompt (what the writer put in the lead): a question, "Recall", an imperative. */
export function isPromptLead(lead: string): boolean {
  const t = lead.trim();
  return (
    /\?/.test(t) ||
    /^(recall|rappelle|name|count|look|share|say|is|what|how|which)\b/i.test(t) ||
    /\b(recall|rappelle-toi)\b/i.test(t)
  );
}

// ─── pixel gate ─────────────────────────────────────────────────────────────────────────────────

export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** Decode a JPEG or PNG to RGBA (undefined for anything else). */
export function decode(bytes: Uint8Array): Pixels | undefined {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const j = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 256 });
      return { width: j.width, height: j.height, data: j.data };
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const img = UPNG.decode(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);
      return { width: img.width, height: img.height, data: rgba };
    }
  } catch {}
  return undefined;
}

/**
 * RMS contrast (the standard deviation of luminance, 0-1) and dark-channel haze: the mean, over
 * 15-px patches, of the patch's darkest channel value (0-1). A clear outdoor photo has dark-channel
 * values near 0 almost everywhere (He et al. 2009); mist and a washed-out sky lift them.
 * Sampled on a grid of at most ~160 px on the long side, so a 280x200 thumbnail and a 768 px frame
 * give comparable numbers.
 */
export function pixelStats(p: Pixels): { rms: number; haze: number; colour: number } {
  const step = Math.max(1, Math.round(Math.max(p.width, p.height) / 160));
  const w = Math.floor(p.width / step);
  const h = Math.floor(p.height / step);
  const lum = new Float32Array(w * h);
  const dark = new Float32Array(w * h);
  // Hasler and Suesstrunk (2003) colourfulness over the same grid: grey, misty, muddy frames are low.
  let rgS = 0;
  let rgQ = 0;
  let ybS = 0;
  let ybQ = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * step * p.width + x * step) * 4;
      const r = (p.data[i] ?? 0) / 255;
      const g = (p.data[i + 1] ?? 0) / 255;
      const b = (p.data[i + 2] ?? 0) / 255;
      lum[y * w + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      dark[y * w + x] = Math.min(r, g, b);
      const rg = r - g;
      const yb = 0.5 * (r + g) - b;
      rgS += rg;
      rgQ += rg * rg;
      ybS += yb;
      ybQ += yb * yb;
    }
  const N = w * h || 1;
  const sd = (s1: number, s2: number) => Math.sqrt(Math.max(0, s2 / N - (s1 / N) ** 2));
  const colour =
    Math.sqrt(sd(rgS, rgQ) ** 2 + sd(ybS, ybQ) ** 2) +
    0.3 * Math.sqrt((rgS / N) ** 2 + (ybS / N) ** 2);
  let mean = 0;
  for (const v of lum) mean += v;
  mean /= lum.length || 1;
  let varSum = 0;
  for (const v of lum) varSum += (v - mean) ** 2;
  const rms = Math.sqrt(varSum / (lum.length || 1));
  // Dark channel: the minimum over a patch about 1/10 of the short side.
  const r = Math.max(1, Math.round(Math.min(w, h) / 20));
  let hz = 0;
  let cnt = 0;
  for (let y = r; y < h - r; y += r)
    for (let x = r; x < w - r; x += r) {
      let m = 1;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) m = Math.min(m, dark[(y + dy) * w + x + dx] ?? 1);
      hz += m;
      cnt++;
    }
  return { rms, haze: cnt ? hz / cnt : 0, colour };
}

/**
 * Thresholds set on base4's accepted stock pictures (bun lab/bakeoff/ab/polishgate.ts --write):
 * the 5th percentile of colourfulness and RMS contrast and the 95th of haze, so 95% pass each.
 */
export type PhotoGate = {
  colourMin: number;
  rmsMin: number;
  hazeMax: number;
  /** The metrics that refuse; the rest are logged as advice. */
  active: ("colour" | "rms" | "haze")[];
};
export const PHOTO_GATE = JSON.parse(
  readFileSync(`${import.meta.dir}/polish-gate.json`, "utf8"),
) as PhotoGate;

export function gateVerdict(s: { rms: number; haze: number; colour: number }, g = PHOTO_GATE) {
  const faults: { metric: PhotoGate["active"][number]; why: string }[] = [];
  if (s.colour < g.colourMin)
    faults.push({
      metric: "colour",
      why: `dull (colourfulness ${s.colour.toFixed(3)} < ${g.colourMin})`,
    });
  if (s.rms < g.rmsMin)
    faults.push({ metric: "rms", why: `low contrast (rms ${s.rms.toFixed(3)} < ${g.rmsMin})` });
  if (s.haze > g.hazeMax)
    faults.push({ metric: "haze", why: `hazy (dark channel ${s.haze.toFixed(3)} > ${g.hazeMax})` });
  const refusing = faults.filter((f) => g.active.includes(f.metric));
  return {
    pass: refusing.length === 0,
    why: refusing.map((f) => f.why),
    advice: faults.filter((f) => !g.active.includes(f.metric)).map((f) => f.why),
  };
}

/** The judge pool's gate: fetch each candidate's thumbnail, refuse low-contrast or hazy frames. */
export function photoGate(log: (e: object) => void) {
  return async (c: { id: string; src: { tiny?: string; medium?: string } }) => {
    const url = c.src.tiny ?? c.src.medium;
    if (!url) return true;
    try {
      const bytes = url.startsWith("data:")
        ? Uint8Array.from(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"))
        : new Uint8Array(
            await (await fetch(url, { signal: AbortSignal.timeout(8000) })).arrayBuffer(),
          );
      const px = decode(bytes);
      if (!px) return true;
      const s = pixelStats(px);
      const v = gateVerdict(s);
      if (!v.pass || v.advice.length)
        log({
          ev: v.pass ? "photo-gate-advice" : "photo-gate-refused",
          id: c.id,
          ...s,
          why: [...v.why, ...v.advice],
        });
      return v.pass;
    } catch (e) {
      log({ ev: "photo-gate-error", id: c.id, err: String(e).slice(0, 120) });
      return true;
    }
  };
}

// ─── judge input cost ──────────────────────────────────────────────────────────────────────────

/** GPT-6 Luna image input tokens (packages/ai/src/budget-estimate.ts's 32-px patch formula). */
export const imageTokens = (w: number, h: number) =>
  Math.ceil(Math.ceil(w / 32) * Math.ceil(h / 32) * 1.2) + 1;
/** A frame scaled to `long` px on its long side, at aspect w:h. */
export const scaledTo = (w: number, h: number, long: number) =>
  w >= h ? [long, Math.round((long * h) / w)] : [Math.round((long * w) / h), long];
