import { z } from "zod";
import { type Provenance, provenanceFields } from "./generated-from";
import { isLinkableHref } from "./links";
import { type RichDoc, RichDocSchema } from "./rich-text";

/*
 * Slides and their elements (ADR 0021). Units are logical points: a slide is 960x540 (the
 * PowerPoint 16:9 default in points, 13.333in x 7.5in), so PPTX export is a 1:1 mapping and PDF
 * is 1pt = 1pt. Behavioural reference: TeachDeck `lib/model/types.ts:1-312,434-462` and
 * `lib/model/schema.ts:39-323`.
 */

export const SLIDE_W = 960;
export const SLIDE_H = 540;
export const SLIDE_ASPECT = SLIDE_W / SLIDE_H;

/** Document ids are TeachDeck ids (nanoid), not the branded persistence-row ids in `../ids`. */
export type Id = string;

/* ------------------------------------------------------------------ */
/* Slide                                                               */
/* ------------------------------------------------------------------ */

export type SlideKind =
  | "blank"
  | "title"
  | "objectives"
  | "starter"
  | "vocabulary"
  | "content"
  | "image-text"
  | "worked-example"
  | "instructions"
  | "discussion"
  | "true-false"
  | "multiple-choice"
  | "matching"
  | "image-match"
  | "fill-gap"
  | "sort"
  | "open-response"
  | "exit-ticket"
  | "timer"
  | "plenary";

export type TransitionId = "none" | "fade" | "push" | "morph";

export type Slide = {
  id: Id;
  kind: SlideKind;
  /** Optional per-slide background override; theme background otherwise. */
  background?: { color?: string; image?: string; imageFit?: "cover" | "contain" };
  /** Draw order = array order. Last is on top. */
  elements: SlideElement[];
  /** Presenter notes (plain text / markdown). */
  notes?: string;
  transition?: TransitionId;
  /**
   * Question slides carry their answer data here rather than on option elements, so reveal
   * logic and export never have to walk the element tree.
   */
  question?: QuestionData;
};

/* ------------------------------------------------------------------ */
/* Question data                                                       */
/* ------------------------------------------------------------------ */

export type QuestionData =
  | { type: "true-false"; correct: boolean; explanation?: string }
  | {
      type: "multiple-choice";
      options: { id: Id; correct: boolean }[];
      multi?: boolean;
      explanation?: string;
    }
  | { type: "matching"; pairs: { id: Id; leftElementId: Id; rightElementId: Id }[] }
  /** Words to pictures. `labelId` is the word that belongs under `imageId`, wherever it sits now. */
  | { type: "image-match"; pairs: { id: Id; imageId: Id; labelId: Id }[] }
  | { type: "fill-gap"; gaps: { id: Id; answer: string; alternatives?: string[] }[] }
  | { type: "sort"; order: Id[] } // element ids in the correct order
  | { type: "open-response"; modelAnswer?: string };

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

type ElementBase = {
  id: Id;
  /** Top-left in slide points. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, about the centre. */
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  /** Shown in the layers list; defaults to the type. */
  name?: string;
  /**
   * Reveal step. 0 or undefined = visible from the start. n>0 = appears when the presenter
   * advances to step n. A slide's step count is max(revealStep).
   */
  revealStep?: number;
  /** Optional entrance animation when revealed. */
  reveal?: "fade" | "rise" | "none";
  /** Shared across slides for the 'morph' transition. */
  morphKey?: string;
} & Provenance;

export type TextPreset = "title" | "subtitle" | "heading" | "body" | "small" | "caption";

export type TextStyle = {
  preset: TextPreset;
  /** Overrides. Absent = inherit from theme for the preset. */
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  fontWeight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  /** Grow height to fit content (default true for new text). */
  autoHeight?: boolean;
  /** Shrink font to fit the box when content overflows. */
  autoFit?: boolean;
  padding?: number;
  background?: string;
  radius?: number;
};

export type TextElement = ElementBase & {
  type: "text";
  doc: RichDoc;
  style: TextStyle;
};

export type ImageElement = ElementBase & {
  type: "image";
  /** A URL by contract (ADR 0021 §5); data URLs are accepted while there is no upload endpoint. */
  src: string;
  alt?: string;
  fit: "cover" | "contain";
  /** Fractional crop rect (0..1) applied before fit. */
  crop?: { x: number; y: number; w: number; h: number };
  radius?: number;
  /** Attribution for a searched image: "Title by Creator, CC BY 2.0". */
  credit?: string;
  /** The page the searched image came from, linked beside the credit. */
  creditUrl?: string;
};

export type ShapeKind =
  | "rect"
  | "rounded"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "star"
  | "speech"
  | "pill";

export type ShapeElement = ElementBase & {
  type: "shape";
  shape: ShapeKind;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  /** Optional centred label. */
  doc?: RichDoc;
  textStyle?: Partial<TextStyle>;
};

export type LineElement = ElementBase & {
  type: "line";
  /** Endpoints as fractions of the bounding box (0..1) so the box is the transform target. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  stroke?: string;
  strokeWidth?: number;
  dash?: "solid" | "dashed" | "dotted";
  arrowStart?: boolean;
  arrowEnd?: boolean;
};

export type IconElement = ElementBase & {
  type: "icon";
  /** lucide icon name in kebab-case, e.g. 'lightbulb'. */
  icon: string;
  color?: string;
  strokeWidth?: number;
};

export type TableElement = ElementBase & {
  type: "table";
  rows: string[][];
  header?: boolean;
  colWidths?: number[]; // fractions summing to 1
  fontSize?: number;
  stripe?: boolean;
};

export type EmbedElement = ElementBase & {
  type: "embed";
  /** YouTube/Vimeo URL; rendered as an iframe in view/present, a poster in capture. */
  url: string;
};

/**
 * An answer option on a question slide. Its correctness lives in slide.question so the element
 * is pure presentation.
 */
export type OptionElement = ElementBase & {
  type: "option";
  doc: RichDoc;
  /** A, B, C… or ✓/✗ for true/false. */
  label?: string;
  textStyle?: Partial<TextStyle>;
};

/** A "gap" text: inline [[gap:id]] tokens in the doc are blanks until revealed. */
export type GapTextElement = ElementBase & {
  type: "gap-text";
  doc: RichDoc;
  style: TextStyle;
};

export type TimerElement = ElementBase & {
  type: "timer";
  seconds: number;
  autoStart?: boolean;
};

export type GroupElement = ElementBase & {
  type: "group";
  /** Children positioned in the group's local space (0,0 = group top-left). */
  children: SlideElement[];
};

export type SlideElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | LineElement
  | IconElement
  | TableElement
  | EmbedElement
  | OptionElement
  | GapTextElement
  | TimerElement
  | GroupElement;

export type ElementType = SlideElement["type"];

/* ------------------------------------------------------------------ */
/* Element schemas                                                     */
/* ------------------------------------------------------------------ */

const elementBase = {
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  locked: z.boolean().optional(),
  name: z.string().optional(),
  revealStep: z.number().optional(),
  reveal: z.enum(["fade", "rise", "none"]).optional(),
  morphKey: z.string().optional(),
  // F06 / F07 provenance (ADR 0025 §2). Declared here because `z.object` strips unknown keys.
  ...provenanceFields,
};

export const TextPresetSchema = z.enum([
  "title",
  "subtitle",
  "heading",
  "body",
  "small",
  "caption",
]);

export const TextStyleSchema = z.object({
  preset: TextPresetSchema,
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  lineHeight: z.number().optional(),
  fontWeight: z.number().optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  autoHeight: z.boolean().optional(),
  autoFit: z.boolean().optional(),
  padding: z.number().optional(),
  background: z.string().optional(),
  radius: z.number().optional(),
});

export const ShapeKindSchema = z.enum([
  "rect",
  "rounded",
  "ellipse",
  "triangle",
  "diamond",
  "star",
  "speech",
  "pill",
]);

const TextElementSchema = z.object({
  ...elementBase,
  type: z.literal("text"),
  doc: RichDocSchema,
  style: TextStyleSchema,
});

const ImageElementSchema = z.object({
  ...elementBase,
  type: z.literal("image"),
  src: z.string(),
  alt: z.string().optional(),
  fit: z.enum(["cover", "contain"]),
  crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  radius: z.number().optional(),
  credit: z.string().optional(),
  // The credit line renders as an anchor in the image toolbar, and an imported lesson is
  // untrusted JSON: a `javascript:` address here would be a click away from running. Same check
  // the toolbar makes, so a stored value that the toolbar would refuse to link never gets stored
  // in the first place.
  creditUrl: z.string().refine(isLinkableHref, "creditUrl must be an http(s) address").optional(),
});

const ShapeElementSchema = z.object({
  ...elementBase,
  type: z.literal("shape"),
  shape: ShapeKindSchema,
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  radius: z.number().optional(),
  doc: RichDocSchema.optional(),
  textStyle: TextStyleSchema.partial().optional(),
});

const LineElementSchema = z.object({
  ...elementBase,
  type: z.literal("line"),
  from: z.object({ x: z.number(), y: z.number() }),
  to: z.object({ x: z.number(), y: z.number() }),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  dash: z.enum(["solid", "dashed", "dotted"]).optional(),
  arrowStart: z.boolean().optional(),
  arrowEnd: z.boolean().optional(),
});

const IconElementSchema = z.object({
  ...elementBase,
  type: z.literal("icon"),
  icon: z.string(),
  color: z.string().optional(),
  strokeWidth: z.number().optional(),
});

const TableElementSchema = z.object({
  ...elementBase,
  type: z.literal("table"),
  rows: z.array(z.array(z.string())),
  header: z.boolean().optional(),
  colWidths: z.array(z.number()).optional(),
  fontSize: z.number().optional(),
  stripe: z.boolean().optional(),
});

const EmbedElementSchema = z.object({
  ...elementBase,
  type: z.literal("embed"),
  url: z.string(),
});

const OptionElementSchema = z.object({
  ...elementBase,
  type: z.literal("option"),
  doc: RichDocSchema,
  label: z.string().optional(),
  textStyle: TextStyleSchema.partial().optional(),
});

const GapTextElementSchema = z.object({
  ...elementBase,
  type: z.literal("gap-text"),
  doc: RichDocSchema,
  style: TextStyleSchema,
});

const TimerElementSchema = z.object({
  ...elementBase,
  type: z.literal("timer"),
  seconds: z.number(),
  autoStart: z.boolean().optional(),
});

const GroupElementSchema = z.object({
  ...elementBase,
  type: z.literal("group"),
  get children() {
    return z.array(SlideElementSchema);
  },
});

export const SlideElementSchema: z.ZodType<SlideElement> = z.discriminatedUnion("type", [
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
  LineElementSchema,
  IconElementSchema,
  TableElementSchema,
  EmbedElementSchema,
  OptionElementSchema,
  GapTextElementSchema,
  TimerElementSchema,
  GroupElementSchema,
]) as z.ZodType<SlideElement>;

/* ------------------------------------------------------------------ */
/* Question data and slide schemas                                     */
/* ------------------------------------------------------------------ */

export const QuestionDataSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("true-false"),
    correct: z.boolean(),
    explanation: z.string().optional(),
  }),
  z.object({
    type: z.literal("multiple-choice"),
    options: z.array(z.object({ id: z.string(), correct: z.boolean() })),
    multi: z.boolean().optional(),
    explanation: z.string().optional(),
  }),
  z.object({
    type: z.literal("matching"),
    pairs: z.array(
      z.object({ id: z.string(), leftElementId: z.string(), rightElementId: z.string() }),
    ),
  }),
  z.object({
    type: z.literal("image-match"),
    pairs: z.array(z.object({ id: z.string(), imageId: z.string(), labelId: z.string() })),
  }),
  z.object({
    type: z.literal("fill-gap"),
    gaps: z.array(
      z.object({
        id: z.string(),
        answer: z.string(),
        alternatives: z.array(z.string()).optional(),
      }),
    ),
  }),
  z.object({ type: z.literal("sort"), order: z.array(z.string()) }),
  z.object({ type: z.literal("open-response"), modelAnswer: z.string().optional() }),
]);

export const SlideKindSchema = z.enum([
  "blank",
  "title",
  "objectives",
  "starter",
  "vocabulary",
  "content",
  "image-text",
  "worked-example",
  "instructions",
  "discussion",
  "true-false",
  "multiple-choice",
  "matching",
  "image-match",
  "fill-gap",
  "sort",
  "open-response",
  "exit-ticket",
  "timer",
  "plenary",
]);

type WalkedElement = { id: string; type: string; children?: unknown };
type IssuePath = (string | number)[];

export const SlideSchema = z
  .object({
    id: z.string(),
    kind: SlideKindSchema,
    background: z
      .object({
        color: z.string().optional(),
        image: z.string().optional(),
        imageFit: z.enum(["cover", "contain"]).optional(),
      })
      .optional(),
    elements: z.array(SlideElementSchema),
    notes: z.string().optional(),
    transition: z.enum(["none", "fade", "push", "morph"]).optional(),
    question: QuestionDataSchema.optional(),
  })
  .superRefine((slide, ctx) => {
    // Ids are the addressing scheme for the whole model: enforce uniqueness and referential
    // integrity.
    const ids = new Set<string>();
    const typeById = new Map<string, string>();
    const walk = (els: WalkedElement[], path: IssuePath) => {
      els.forEach((el, i) => {
        if (ids.has(el.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate element id "${el.id}"`,
            path: [...path, i, "id"],
          });
        }
        ids.add(el.id);
        typeById.set(el.id, el.type);
        if (el.type === "group" && Array.isArray(el.children)) {
          walk(el.children as WalkedElement[], [...path, i, "children"]);
        }
      });
    };
    walk(slide.elements as WalkedElement[], ["elements"]);
    const must = (id: string, path: IssuePath) => {
      if (!ids.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `question references missing element "${id}"`,
          path,
        });
      }
    };
    /*
     * The renderers do not just need the element to exist, they need it to be the right
     * shape: `ImageMatchAnswers` reads the word's rich text and draws a card over the
     * picture's rect, so a pair pointing at a shape renders nothing and says nothing about why.
     */
    const mustBe = (id: string, types: string[], path: IssuePath) => {
      if (!ids.has(id)) {
        must(id, path);
        return;
      }
      const type = typeById.get(id);
      if (type && !types.includes(type)) {
        ctx.addIssue({
          code: "custom",
          message: `question expects ${types.join(" or ")} for "${id}", found ${type}`,
          path,
        });
      }
    };
    const q = slide.question;
    if (!q) return;
    if (q.type === "multiple-choice") {
      q.options.forEach((o, i) => {
        must(o.id, ["question", "options", i, "id"]);
      });
    }
    if (q.type === "matching") {
      q.pairs.forEach((p, i) => {
        // A term or definition card is text or an option; both carry the doc the matching
        // drawer and the reveal read.
        mustBe(p.leftElementId, ["text", "option"], ["question", "pairs", i, "leftElementId"]);
        mustBe(p.rightElementId, ["text", "option"], ["question", "pairs", i, "rightElementId"]);
      });
    }
    if (q.type === "image-match") {
      q.pairs.forEach((p, i) => {
        mustBe(p.imageId, ["image"], ["question", "pairs", i, "imageId"]);
        mustBe(p.labelId, ["text"], ["question", "pairs", i, "labelId"]);
      });
    }
    if (q.type === "sort") {
      q.order.forEach((id, i) => {
        must(id, ["question", "order", i]);
      });
    }
    if (q.type === "fill-gap") {
      const text = JSON.stringify(slide.elements);
      q.gaps.forEach((g, i) => {
        if (!text.includes(`[[gap:${g.id}]]`)) {
          ctx.addIssue({
            code: "custom",
            message: `gap "${g.id}" has no [[gap:${g.id}]] token`,
            path: ["question", "gaps", i, "id"],
          });
        }
      });
    }
  });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function slideStepCount(slide: Slide): number {
  let max = 0;
  const walk = (els: SlideElement[]) => {
    for (const el of els) {
      if (el.revealStep && el.revealStep > max) max = el.revealStep;
      if (el.type === "group") walk(el.children);
    }
  };
  walk(slide.elements);
  // Question slides get one extra step for "reveal answer" — but only when there is an answer
  // to reveal.
  if (hasRevealableAnswer(slide)) max += 1;
  return max;
}

/**
 * Whether the last step of this slide shows the pupil something new.
 *
 * Every question kind draws its own answer on reveal except open response, whose whole reveal
 * is the model answer: with that field still blank the extra step costs the presenter a Right
 * arrow on a slide that does not change. Reveal gates key off this rather than off the mere
 * presence of a question.
 */
export function hasRevealableAnswer(slide: Slide): boolean {
  const q = slide.question;
  if (!q) return false;
  if (q.type === "open-response") return !!q.modelAnswer?.trim();
  return true;
}
