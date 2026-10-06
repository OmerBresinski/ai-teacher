// Arm C: find_picture. Real: the picture director + bank (as SOL-SIMPLE/fill.ts, on this worktree's
// packages), ruling 163 held by the bank. Stub: a labelled placeholder SVG, no calls.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { Writable } from "node:stream";

const WT = resolve(import.meta.dir, "../..");
export interface PictureAsk {
  slide: number;
  request: string;
  kind: "named" | "generic";
  period?: string;
  aspect?: number;
}
export interface PictureLesson {
  title: string;
  yearGroup: string;
  subject: string;
  slideCount: number;
  objectives?: { teacher: string }[];
}
export interface Picture {
  ok: true;
  picture_id: string;
  src: string;
  width: number;
  height: number;
  aspect: number;
  shows: string;
  source: string;
  style: string;
  credit: string;
}
export type PictureResult = Picture | { ok: false; reason: string };
export interface PictureSlide {
  heading: string;
  text: string;
}
export type FindPicture = (
  ask: PictureAsk,
  id: string,
  slide: PictureSlide,
) => Promise<PictureResult>;

/** Pixel size of a PNG or JPEG (else 1600x1000). */
export function imageSize(file: string): [number, number] {
  const b = readFileSync(file);
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return [1600, 1000];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function stubPictures(runDir: string): FindPicture {
  return async (ask, id) => {
    const a = ask.aspect ?? 1.6;
    const w = 1600,
      h = Math.round(w / a);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#cfd8dc"/><text x="50%" y="50%" font-size="56" text-anchor="middle" font-family="sans-serif" fill="#37474f">STUB ${esc(ask.kind)}: ${esc(ask.request.slice(0, 40))}</text></svg>`;
    writeFileSync(join(runDir, "assets", `${id}.svg`), svg);
    await Bun.sleep(30);
    return {
      ok: true,
      picture_id: id,
      src: `assets/${id}.svg`,
      width: w,
      height: h,
      aspect: a,
      shows: ask.request,
      source: "stub",
      style: "drawn",
      credit: "stub",
    };
  };
}

/**
 * The real path: the shared harness's capped picture service (lab/bakeoff/services.ts
 * `pictureService`, as T, K and R use it): picture director + bank, generations reserved against
 * the per-run picture cap ($0.06) by `guardedGenerator`, so parallel asks cannot pass it.
 */
export async function realPictures(
  runDir: string,
  lesson: PictureLesson,
  pgPort: number,
): Promise<{ find: FindPicture; spent: () => number }> {
  const {
    pictureService,
    Ledger,
    STORE,
    pickerLesson: _p,
  } = await import(`${WT}/lab/bakeoff/services.ts`);
  void _p;
  const ledger = new Ledger(Number.POSITIVE_INFINITY); // C's run cap is its own budget (budget.ts)
  const svc = pictureService({
    runDir,
    pgPort,
    ledger,
    bankCapUsd: Number(process.env.PICTURE_CAP ?? 0.06),
  });
  const { newId } = await import(`${WT}/packages/domain/src/index.ts`);
  const id0 = newId();
  const base = {
    brief: { topic: lesson.title },
    facts: {
      objectives: (lesson.objectives ?? []).map((o, k) => ({ id: `o${k + 1}`, text: o.teacher })),
      vocabulary: [],
      keyIdeas: [],
    },
  };
  const find: FindPicture = async (ask, id, slide) => {
    const r = await svc.find(
      {
        key: id,
        shows: ask.period ? `${ask.request} (${ask.period})` : ask.request,
        mustSee: [],
        named: ask.kind === "named",
        ...(ask.aspect ? { aspect: ask.aspect } : {}),
        slide: { heading: slide.heading, text: slide.text, point: "" },
        index: ask.slide - 1,
      },
      { id: id0, title: lesson.title, yearGroup: lesson.yearGroup, subject: lesson.subject, base },
    );
    if (!r)
      return {
        ok: false,
        reason:
          "no picture fits (the director chose none, every candidate failed the judge, or the picture budget is spent)",
      };
    const srcPath = resolve(STORE, String(r.src).replace(/^\/files\//, ""));
    const ext = extname(srcPath) || ".jpg";
    try {
      copyFileSync(srcPath, join(runDir, "assets", `${id}${ext}`));
    } catch (e) {
      return {
        ok: false,
        reason: `picture found but its file could not be read (${String(e).slice(0, 80)})`,
      };
    }
    const [w, h] = imageSize(join(runDir, "assets", `${id}${ext}`));
    const src: any = r.source ?? {};
    return {
      ok: true,
      picture_id: id,
      src: `assets/${id}${ext}`,
      width: w,
      height: h,
      aspect: +(w / h).toFixed(2),
      shows: r.alt ?? ask.request,
      source: r.provider ?? "?",
      style: src.style ?? "photo", // a generated picture with no style is a photo (ruling 163 gate)
      credit: [src.photographer ?? src.author, src.licence].filter(Boolean).join(", "),
    };
  };
  return { find, spent: () => (ledger.parts.pictures ?? 0) + svc.aiSpend() };
}
