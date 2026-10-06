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

/** The real path. `costs` collects director/judge and bank spend. Imports only; no call until used. */
export async function realPictures(
  runDir: string,
  lesson: PictureLesson,
  costs: { ai: number; bank: number },
  pgUrl: string,
): Promise<FindPicture> {
  const okey = readFileSync(`${homedir()}/.dayback-openai-key`, "utf8").trim();
  const { createAi, createBudget } = await import(`${WT}/packages/ai/src/index.ts`);
  const pino = (await import(`${WT}/apps/worker/node_modules/pino/pino.js`)).default;
  const aiLog = join(runDir, "pictures.ai.jsonl");
  const sink = (f: string) =>
    new Writable({
      write(c, _e, cb) {
        const s = c.toString();
        appendFileSync(f, s);
        for (const l of s.split("\n"))
          if (l.trim())
            try {
              costs.ai += JSON.parse(l).ai?.costUsd ?? 0;
            } catch {}
        cb();
      },
    });
  const MODEL = "openai/gpt-6-luna";
  const ai = createAi(
    {
      OPENAI_API_KEY: okey,
      AI_MODEL_FRONTIER: MODEL,
      AI_MODEL_STANDARD: MODEL,
      AI_MODEL_SMALL: MODEL,
    },
    { logger: pino({ level: "info" }, sink(aiLog)) },
  );
  const { pickPhoto, judgeMade, plainSubject } = await import(
    `${WT}/packages/generation/src/stages/illustrate.ts`
  );
  const { mustShowOf } = await import(`${WT}/packages/generation/src/stages/photo-bank.ts`);
  const { findDirected } = await import(`${WT}/packages/generation/src/stages/picture-director.ts`);
  const im = await import(`${WT}/packages/images/src/index.ts`);
  const { createDb } = await import(`${WT}/packages/db/src/index.ts`);
  const { createStorage } = await import(`${WT}/packages/storage/src/index.ts`);
  const { createPictureBank } = await import(`${WT}/apps/worker/src/picture-bank.ts`);
  const { newId } = await import(`${WT}/packages/domain/src/index.ts`);
  // The bank DB copy (5619, from base 5616) and its files (copied from base-pg/store) go together.
  const root =
    process.env.PICTURE_STORE ??
    resolve(import.meta.dir, "../../../quality-prd/lab/rounds/BAKEOFF/arm-c/pg/store");
  mkdirSync(root, { recursive: true });
  const WS = "0e7a1000-0000-4000-8000-000000000e7c";
  const storage = {
    put: async (k: string, body: any) => {
      const bytes =
        body instanceof ReadableStream
          ? new Uint8Array(await new Response(body).arrayBuffer())
          : body;
      mkdirSync(resolve(root, k, ".."), { recursive: true });
      writeFileSync(resolve(root, k), bytes);
      return { key: k };
    },
  };
  const pex = im.createPexelsClient({
    apiKey: readFileSync(`${homedir()}/.dayback-pexels-key`, "utf8").trim(),
  });
  const commons = im.createCommonsClient();
  const bank0 = createPictureBank({
    db: (() => {
      const d = createDb(pgUrl);
      return d.unsafeDb ?? d.db;
    })(),
    storage: createStorage({ STORAGE_ROOT: root }).adapter,
    embedder: im.createOpenAiEmbedder({ apiKey: okey }),
    generator: im.createOpenAiImageGenerator({ apiKey: okey }),
    capUsd: Number(process.env.BANK_CAP ?? "0.03"),
    ids: () => newId(),
    onEvent: (e: any) => {
      costs.bank += e.costUsd ?? 0;
      appendFileSync(
        join(runDir, "pictures.bank.jsonl"),
        `${JSON.stringify({ t: Date.now(), ...e })}\n`,
      );
    },
  });
  const base = {
    id: newId(),
    title: lesson.title,
    yearGroup: lesson.yearGroup,
    subject: lesson.subject,
    // Every facts field the production picture code reads (as onecall services.ts pickerLesson): a
    // missing one threw inside the judge (C smoke 1: every stock pick failed, every generation refused).
    brief: { topic: lesson.title },
    facts: {
      objectives: (lesson.objectives ?? []).map((o, k) => ({ id: `o${k + 1}`, text: o.teacher })),
      vocabulary: [] as unknown[],
      keyIdeas: [] as unknown[],
      outline: [] as any[],
    },
  };
  return async (ask, id, slide) => {
    // The agent's period is binding (ruling 163): the bank sees every request for this slot as historical.
    const bank = ask.period
      ? {
          ...bank0,
          lookup: (r: any, s: any) => bank0.lookup({ ...r, period: r.period ?? ask.period }, s),
          generate: (r: any, f: any, s: any) =>
            bank0.generate({ ...r, period: r.period ?? ask.period }, f, s),
        }
      : bank0;
    const index = ask.slide - 1;
    const request = ask.period ? `${ask.request} (${ask.period})` : ask.request;
    const deps: any = {
      ai,
      budget: createBudget({ capUsd: 0.05, capTokens: 2_000_000 }),
      effortFor: () => "low",
      signal: new AbortController().signal,
      logger: pino({ level: "info" }, sink(join(runDir, "pictures.log.jsonl"))),
      now: () => new Date(),
      ids: () => newId(),
      images: {
        search: (q: string, o: any) =>
          pex.search({ query: q, ...o, locale: "en-GB" }).then((p: any) => p.photos),
        store: (photo: unknown, target: string) =>
          im.storePhoto({ photo, target, storage, workspaceId: WS }),
        searchCommons: (q: string, o: any) => commons.search({ query: q, ...o }),
        bank,
      },
      context: { lessonId: base.id, jobId: `arm-c-${id}` },
    };
    const b = {
      subject: plainSubject(request).slice(0, 60),
      request: request.trim().slice(0, 400),
      mustShow: mustShowOf(request),
      purpose: "context",
      specific: ask.kind === "named",
      aspect: ask.aspect ?? 1.6,
    };
    const outline = Array.from({ length: Math.max(lesson.slideCount, index + 1) }, (_, i) => ({
      id: `s${i + 1}`,
      kind: i === index ? "image-text" : "content",
      factRefs: [],
    }));
    const at = (x: any) =>
      pickPhoto(
        {
          ...base,
          facts: {
            ...base.facts,
            outline: outline.map((o, i) => (i === index ? { ...o, imageBrief: x } : o)),
          },
        },
        index,
        deps,
      ).catch(() => ({ outcome: "empty" }));
    const stock = async (first: any) => {
      const r: any = await at(first);
      return r.outcome === "placed" ? r.photo : undefined;
    };
    const photo: any = await findDirected({
      bank,
      ask: {
        subject: request,
        named: ask.kind === "named" ? plainSubject(request).slice(0, 60) : null,
      },
      brief: b,
      slide: { heading: slide.heading, text: slide.text, point: "" },
      lesson: base,
      country: "England",
      index,
      stock,
      judgeMade: (brief: any, made: any) =>
        made.dataUrl
          ? judgeMade({ lesson: base, index, brief, deps, dataUrl: made.dataUrl })
          : Promise.resolve(true),
      deps,
    }).catch((e: unknown) => {
      appendFileSync(join(runDir, "pictures.err.log"), `${id} ${String(e)}\n`);
      return undefined;
    });
    if (!photo)
      return {
        ok: false,
        reason: "no picture fits (the director chose none, or every candidate failed the judge)",
      };
    // Copy the stored file into assets/ so the slide can reference it.
    const srcPath = resolve(
      root,
      String(photo.src ?? "")
        .replace(/^\/files\//, "")
        .replace(/^\//, ""),
    );
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
    const s = photo.source ?? {};
    return {
      ok: true,
      picture_id: id,
      src: `assets/${id}${ext}`,
      width: w,
      height: h,
      aspect: +(w / h).toFixed(2),
      shows: photo.alt ?? ask.request,
      source: s.provider ?? "?",
      style: photo.style ?? (s.provider === "generated" ? "photo" : "photo"),
      credit: [s.photographer ?? s.author, s.licence].filter(Boolean).join(", "),
    };
  };
}
