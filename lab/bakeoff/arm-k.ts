// BAKEOFF arm K: the model writes each slide as typed blocks plus one recipe id; code places them
// (`packages/slides/src/blocks`). Prompt and schema: BAKEOFF/prompts/K/{system,schema}.<KS1|KS2|KS3-5>.{txt,json}
// (the prompt agent's). Slide JSON: { recipe, heading, blocks: [...] } as BAKEOFF/catalogue/K.json states.
import { existsSync, readFileSync } from "node:fs";
import { type Block, layoutBlocks, type Pic } from "../../packages/slides/src/blocks/index";
import { PLACEHOLDER_IMAGE } from "../../packages/slides/src/layouts";
import type { ArmPlugin, Brief, MaterialiseCtx, VisualAsk } from "./harness";
import { BAKEOFF } from "./services";

type S = Record<string, unknown>;
type PicAsk = { shows?: string; must_see?: string[]; subject?: "named" | "generic" };
const band = (b: Brief) => (b.keyStage === "ks1" ? "KS1" : b.keyStage === "ks2" ? "KS2" : "KS3-5");
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str) : []);
const blocksOf = (s: S): S[] =>
  (Array.isArray(s.blocks) ? s.blocks : []).filter((b): b is S => !!b && typeof b === "object");
/** A picture ask may sit on the block itself or under `picture`. */
const askOf = (b: S): PicAsk =>
  (b.picture && typeof b.picture === "object" ? b.picture : b) as PicAsk;

/** Every visual on a slide with a stable key: `b<i>` for a block, `b<i>.<n>` in a sequence, `b<i>.pic` on a card. */
function asksOf(s: S): VisualAsk[] {
  const out: VisualAsk[] = [];
  const photo = (key: string, a: PicAsk): VisualAsk => ({
    key,
    type: "photo",
    shows: str(a.shows),
    mustSee: strs(a.must_see),
    named: a.subject === "named",
  });
  blocksOf(s).forEach((b, i) => {
    if (b.type === "picture") out.push(photo(`b${i}`, askOf(b)));
    else if (b.type === "diagram")
      out.push({
        key: `b${i}`,
        type: "diagram",
        kind: str(b.kind),
        shows: str(b.shows),
        labels: strs(b.labels),
      });
    else if (b.type === "picture-sequence")
      (Array.isArray(b.items) ? (b.items as S[]) : []).forEach((it, n) => {
        out.push(photo(`b${i}.${n}`, askOf(it ?? {})));
      });
    else if (b.type === "card" && b.picture && typeof b.picture === "object")
      out.push(photo(`b${i}.pic`, askOf(b)));
  });
  return out;
}

/** A picture now: the photo when it has landed, an open slot while pending, undefined when it failed. */
function picNow(key: string, ctx: MaterialiseCtx, alt: string): Pic | undefined {
  const v = ctx.visual(key);
  if (v.status === "photo") return { src: v.photo.src, alt: v.photo.alt, aspect: v.photo.aspect };
  if (v.status === "failed") return undefined;
  return { src: PLACEHOLDER_IMAGE, alt };
}

/** The model's slide as engine blocks, with visuals as they stand. */
export function toBlocks(s: S, ctx: MaterialiseCtx): { recipe: string; blocks: Block[] } {
  const out: Block[] = [{ type: "heading", text: str(s.heading) }];
  let recipe = str(s.recipe);
  blocksOf(s).forEach((b, i) => {
    switch (b.type) {
      case "picture": {
        const p = picNow(`b${i}`, ctx, str(askOf(b).shows));
        if (p) out.push({ type: "picture", picture: p });
        break;
      }
      case "diagram": {
        const v = ctx.visual(`b${i}`);
        if (v.status === "diagram") out.push({ type: "diagram", diagram: v.spec });
        else if (v.status !== "failed")
          out.push({
            type: "picture",
            picture: { src: PLACEHOLDER_IMAGE, alt: `Diagram: ${str(b.shows)}` },
          });
        break;
      }
      case "picture-sequence": {
        const items = (Array.isArray(b.items) ? (b.items as S[]) : []).flatMap((it, n) => {
          const p = picNow(`b${i}.${n}`, ctx, str(askOf(it ?? {}).shows));
          return p ? [{ picture: p, caption: str(it?.caption) }] : [];
        });
        if (items.length >= 2) out.push({ type: "picture-sequence", items });
        // Too few pictures came: the captions become numbered points.
        else
          out.push({
            type: "points",
            numbered: true,
            items: (b.items as S[]).map((it) => str(it?.caption)),
          });
        break;
      }
      case "card": {
        const p = b.picture ? picNow(`b${i}.pic`, ctx, str(askOf(b).shows)) : undefined;
        out.push({
          type: "card",
          label: str(b.label),
          text: str(b.text),
          ...(p ? { picture: p } : {}),
        });
        break;
      }
      case "heading":
        // The heading is the slide's own field; a heading block only stands in when that is empty.
        if (!str(s.heading)) (out[0] as { text: string }).text = str(b.text);
        break;
      default:
        out.push(b as unknown as Block);
    }
  });
  // A media recipe whose one visual failed: the words stand alone.
  const media = out.some((b) => b.type === "picture" || b.type === "diagram");
  if (!media && ["media-right", "media-left", "big-media"].includes(recipe)) recipe = "stack";
  if (recipe === "sequence" && !out.some((b) => b.type === "picture-sequence" || b.type === "card"))
    recipe = "stack";
  return { recipe, blocks: out };
}

export const armK: ArmPlugin = {
  id: "K",
  prompt(brief) {
    const k = band(brief);
    const dir = `${BAKEOFF}/prompts/K`;
    if (!existsSync(`${dir}/system.${k}.txt`) || !existsSync(`${dir}/schema.${k}.json`))
      throw new Error(`arm K prompt missing: ${dir}/system.${k}.txt + schema.${k}.json`);
    return {
      system: readFileSync(`${dir}/system.${k}.txt`, "utf8"),
      schema: JSON.parse(readFileSync(`${dir}/schema.${k}.json`, "utf8")),
      model: "gpt-6.1-sol",
      effort: "low",
    };
  },
  visuals: (s) => asksOf(s),
  materialise(s, ctx) {
    const { recipe, blocks } = toBlocks(s, ctx);
    // Slide 2 is the objectives: the plan's pupil objectives, numbered, when the slide holds no list.
    if (ctx.index === 1 && !blocks.some((b) => b.type === "points") && ctx.plan.objectives?.length)
      blocks.push({
        type: "points",
        numbered: true,
        items: ctx.plan.objectives.map((o) => o.pupil),
      });
    const r = layoutBlocks({ recipe, blocks }, ctx.theme, ctx.stage);
    return { slide: r.slide, over: [...r.over, ...r.faults.map((f) => `fault: ${f}`)] };
  },
  codeTitle(brief, ctx) {
    const r = layoutBlocks(
      {
        recipe: "title",
        blocks: [
          { type: "heading", text: brief.topic },
          { type: "text", text: `${brief.yearGroup} ${brief.subject}` },
        ],
      },
      ctx.theme,
      ctx.stage,
    );
    return { slide: r.slide, over: r.over };
  },
  questions(s) {
    return blocksOf(s)
      .filter((b) => b.type === "question")
      .map((b) => str(b.text));
  },
  words(s) {
    const parts = [str(s.heading)];
    for (const b of blocksOf(s)) {
      parts.push(str(b.text), str(b.label), ...strs(b.header));
      if (b.type === "points" || b.type === "options") parts.push(...strs(b.items));
      if (b.type === "table")
        for (const r of (Array.isArray(b.rows) ? b.rows : []) as unknown[]) parts.push(...strs(r));
      if (b.type === "picture-sequence")
        for (const it of (Array.isArray(b.items) ? b.items : []) as S[])
          parts.push(str(it?.caption));
    }
    return parts.filter(Boolean).join("\n");
  },
};
