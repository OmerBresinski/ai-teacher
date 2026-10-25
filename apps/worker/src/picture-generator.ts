/**
 * Generated pictures for the writer planner (TEACH-237, UX ruling 158): the generator behind the
 * director's `PictureBank`, the daily spend cap, and storage for strip panels. With a picture
 * library (TEACH-84 part b, `PICTURE_LIBRARY_REUSE=on`) `lookup` offers a stored picture and
 * `remember` stores each picture a judge passed; without one, `lookup` always misses and `remember`
 * keeps nothing. Logs ids, sizes, costs and reasons only: never the request, prompt or alt (ADR 0015).
 */
import { newId, type StorageAdapter, storageKey, type WorkspaceId } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import type { MadePicture, PictureBank } from "@tj/generation";
import {
  countArraySvg,
  directedImagePrompt,
  expectedImageCostUsd,
  frameCutOf,
  IMAGE_TERMS,
  type ImageGenerator,
  type ImageSize,
  PictureStageError,
  pngSize,
  sizeForAspect,
  withRetryLine,
} from "@tj/images";
import type { MadeProvenance, PictureLibrary } from "./picture-library";

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * What the generator may still spend today (UTC), in this worker process. A generation runs only
 * when its expected cost fits under the cap; its real cost is added once it has run.
 */
export interface DailyImageCap {
  allow(size: ImageSize): boolean;
  spent(usd: number): void;
  spentToday(): number;
}

export function createDailyImageCap(opts: {
  capUsd: number;
  now?: () => Date;
  logger?: Logger;
}): DailyImageCap {
  const now = opts.now ?? (() => new Date());
  let day = "";
  let spent = 0;
  const roll = () => {
    const today = now().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      spent = 0;
    }
  };
  return {
    allow(size) {
      roll();
      const ok = spent + expectedImageCostUsd(size) <= opts.capUsd;
      if (!ok)
        opts.logger?.info(
          {
            stage: "illustrate",
            capUsd: opts.capUsd,
            spentUsd: Number(spent.toFixed(4)),
            size,
            expectedUsd: expectedImageCostUsd(size),
          },
          "image generation daily cap spent: placeholder kept",
        );
      return ok;
    },
    spent(usd) {
      roll();
      spent += usd;
    },
    spentToday() {
      roll();
      return spent;
    },
  };
}

/** The credit every generated picture carries. */
export function generatedSource(id: string, model: string): PhotoSource {
  return {
    provider: "generated",
    id,
    pageUrl: "https://openai.com/policies/",
    photographer: `AI-generated (${model})`,
    photographerUrl: "https://openai.com/policies/",
    licence: `generated (${IMAGE_TERMS})`,
  };
}

/** Store one generated PNG (or drawn SVG) under the workspace's images; its public src. */
export function savePicture(storage: StorageAdapter, workspaceId: WorkspaceId, ids = newId) {
  return async (
    bytes: Uint8Array,
    contentType = "image/png",
  ): Promise<{ id: string; src: string }> => {
    const id = ids();
    const ext = contentType === "image/svg+xml" ? "svg" : "png";
    const key = storageKey(workspaceId, "images", `${id}.${ext}`);
    // Tagged so the picture's trace says the store failed, not the image model (`PictureFailure`).
    await storage.put(key, bytes, { contentType }).catch((e: unknown) => {
      throw e instanceof Error && e.name === "AbortError" ? e : new PictureStageError("save", e);
    });
    return { id, src: `/files/${key}` };
  };
}

/**
 * Delete a stored picture of this workspace's images by its public src (TEACH-167 part b: a
 * judged-out or raced-out generation, or a set panel no slide shows). Any other src is left alone.
 */
export function removePicture(storage: StorageAdapter, workspaceId: WorkspaceId) {
  const prefix = `/files/${storageKey(workspaceId, "images", "_").slice(0, -1)}`;
  return async (src: string): Promise<void> => {
    if (!src.startsWith(prefix) || src.length === prefix.length) return;
    await storage.delete(src.slice("/files/".length));
  };
}

/**
 * FRAME-CUT, measure only: `frameCut` of PNG bytes and how long it took. The decode and edge scan
 * are synchronous (about 70 ms, up to 230 ms), so it yields first: other jobs and pg-boss's timers
 * get a turn before the event loop is held. Undefined when the bytes do not decode.
 */
export async function measureFrame(
  bytes: Uint8Array,
  measure: typeof frameCutOf = frameCutOf,
): Promise<(NonNullable<ReturnType<typeof frameCutOf>> & { ms: number }) | undefined> {
  await new Promise((resolve) => setImmediate(resolve));
  const t0 = performance.now();
  const cut = measure(bytes);
  return cut ? { ...cut, ms: performance.now() - t0 } : undefined;
}

/**
 * The director's bank for one lesson job: a count is drawn in code (free, never capped); any other
 * generation runs at the size nearest the slot's shape under the daily cap and is stored whole, with
 * its own aspect: the slide shows it at that shape (or trims only background, `placePhoto`), so the
 * judge, which gets the same bytes, sees what the slide shows.
 */
export function createGeneratingBank(opts: {
  generator?: Pick<ImageGenerator, "model" | "generate">;
  cap: DailyImageCap;
  save: (bytes: Uint8Array, contentType?: string) => Promise<{ id: string; src: string }>;
  /** Delete a stored picture (`removePicture`); absent, a rejected picture stays stored. */
  remove?: (src: string) => Promise<void>;
  /** The shared picture library (TEACH-84 part b); absent, nothing is reused or stored. */
  library?: PictureLibrary;
  logger: Logger;
}): PictureBank {
  const { library } = opts;
  // What this job generated, by src: the row a judged picture is stored with keeps its provenance.
  const generated = new Map<string, MadeProvenance>();
  return {
    async lookup(req, signal) {
      return library?.lookup(req, signal);
    },
    // `findPicture` calls this only for a picture its judge passed (fetched or generated).
    async remember(req, photo) {
      if (!library) return;
      const provenance = generated.get(photo.src);
      generated.delete(photo.src);
      await library.store(req, photo as MadePicture, provenance);
    },
    // A refused library picture is marked and never offered again (its file stays: other lessons
    // may show it). A refused fresh picture, or a race's loser, is deleted outright.
    async reject(photo) {
      if (library?.owns(photo.src)) return library.reject(photo.src);
      generated.delete(photo.src);
      await opts.remove?.(photo.src);
    },
    async generate(req, faithful, signal, retry) {
      if (req.draw) {
        const svg = countArraySvg(req.draw, req.aspect ?? 1);
        const saved = await opts.save(new TextEncoder().encode(svg), "image/svg+xml");
        const source: PhotoSource = {
          provider: "generated",
          id: saved.id,
          pageUrl: "https://dayback.app/",
          photographer: "Drawn by Dayback",
          photographerUrl: "https://dayback.app/",
          licence: "drawn (dayback)",
        };
        return {
          src: saved.src,
          alt: req.text.trim().slice(0, 300),
          source,
          style: "drawn",
        } as MadePicture;
      }
      if (!opts.generator || !req.imagePrompt) return undefined;
      const { size } = sizeForAspect(req.aspect);
      if (!opts.cap.allow(size)) return undefined;
      // A retry carries why the last try failed, so it never repeats the same prompt.
      const prompt = withRetryLine(directedImagePrompt(req.imagePrompt, faithful), retry);
      const out = await opts.generator.generate({ prompt, size, signal });
      opts.cap.spent(out.costUsd);
      // FRAME-CUT, measure only (21 Oct 2026): how far the subject runs off the frame, recorded on
      // the picture's trace and outcome event; nothing is redrawn on it. A decode failure is no
      // measure, never a failed picture.
      const frame =
        out.mime === "image/png" ? await measureFrame(out.bytes).catch(() => undefined) : undefined;
      const saved = await opts.save(out.bytes, out.mime);
      // The picture's own shape (the model returns the size asked; the header is the fact).
      const [sw, sh] = size.split("x").map(Number) as [number, number];
      const dims = pngSize(out.bytes) ?? { width: sw, height: sh };
      opts.logger.info(
        {
          stage: "illustrate",
          generated: saved.id,
          size,
          costUsd: out.costUsd,
          ms: out.ms,
          attempts: out.attempts ?? 1,
          ...(retry ? { retry: retry.reason } : {}),
          ...(frame
            ? { frameCut: frame.cut, framePlain: frame.plain, frameMs: Math.round(frame.ms) }
            : {}),
        },
        "picture generated",
      );
      if (library)
        generated.set(saved.src, {
          generator: opts.generator.model,
          generatorTerms: IMAGE_TERMS,
          prompt,
          costUsd: out.costUsd,
          faithful,
        });
      // No evidence yet: the judge's verdict is the evidence, added where the picture is placed.
      const made: Omit<MadePicture, "evidence"> & { aspect: number } = {
        src: saved.src,
        alt: req.text.trim().slice(0, 300),
        source: generatedSource(saved.id, opts.generator.model),
        aspect: dims.width / dims.height,
        style: req.style ?? "photo",
        ...(req.palette ? { palette: req.palette } : {}),
        costUsd: out.costUsd,
        // For the lesson's debug record (`findPicture`'s trace); never logged or sent.
        prompt,
        ...(frame ? { frame } : {}),
        dataUrl: `data:${out.mime};base64,${Buffer.from(out.bytes).toString("base64")}`,
      };
      return made as unknown as MadePicture;
    },
  };
}
