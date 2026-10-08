/**
 * Generated pictures for the writer planner (TEACH-237, UX ruling 158): the generator behind the
 * director's `PictureBank`, the daily spend cap, and storage for strip panels. No library yet (the
 * reuse store is TEACH-84 part b): `lookup` always misses and `remember` keeps nothing. Logs ids,
 * sizes, costs and reasons only: never the request, prompt or alt (ADR 0015).
 */
import { newId, type StorageAdapter, storageKey, type WorkspaceId } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import type { MadePicture, PictureBank } from "@tj/generation";
import {
  countArraySvg,
  directedImagePrompt,
  expectedImageCostUsd,
  IMAGE_TERMS,
  type ImageGenerator,
  type ImageSize,
  pngSize,
  sizeForAspect,
} from "@tj/images";

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
          { stage: "illustrate", capUsd: opts.capUsd, spentUsd: Number(spent.toFixed(4)), size },
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
    await storage.put(key, bytes, { contentType });
    return { id, src: `/files/${key}` };
  };
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
  logger: Logger;
}): PictureBank {
  return {
    async lookup() {
      return undefined;
    },
    async remember() {},
    async generate(req, faithful, signal) {
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
      const prompt = directedImagePrompt(req.imagePrompt, faithful);
      const out = await opts.generator.generate({ prompt, size, signal });
      opts.cap.spent(out.costUsd);
      const saved = await opts.save(out.bytes, out.mime);
      // The picture's own shape (the model returns the size asked; the header is the fact).
      const [sw, sh] = size.split("x").map(Number) as [number, number];
      const dims = pngSize(out.bytes) ?? { width: sw, height: sh };
      opts.logger.info(
        { stage: "illustrate", generated: saved.id, size, costUsd: out.costUsd, ms: out.ms },
        "picture generated",
      );
      // No evidence yet: the judge's verdict is the evidence, added where the picture is placed.
      const made: Omit<MadePicture, "evidence"> & { aspect: number } = {
        src: saved.src,
        alt: req.text.trim().slice(0, 300),
        source: generatedSource(saved.id, opts.generator.model),
        aspect: dims.width / dims.height,
        style: req.style ?? "photo",
        ...(req.palette ? { palette: req.palette } : {}),
        dataUrl: `data:${out.mime};base64,${Buffer.from(out.bytes).toString("base64")}`,
      };
      return made as unknown as MadePicture;
    },
  };
}
