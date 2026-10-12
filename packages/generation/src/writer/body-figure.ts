/**
 * No freehand bodies (TEACH-247 part ad, STICKFIG): a `labelled-diagram` whose subject is a living
 * thing's body (a person, an animal, a plant, or a body part such as the heart, an eye or a wrist)
 * is never drawn by the freeform drawer. Its primitives (circles, lines, polygons) can only make a
 * stick figure. The slide is rerouted when it opens, before any ask or drawer call: on a full
 * slide to a library model that draws that body, when the lesson has one; otherwise to a picture
 * of the same thing, through the existing diagram-to-picture fallback (its labels become what the
 * picture must show).
 *
 * The drawer's spec marks no shape with what it stands for (`schema.ts` `Shape` has a type and
 * coordinates only), so there is no structured signal, before or after drawing: the decision
 * reads the writer's `shows`. The word lists are kept tight, and phrases that only look like a
 * body ("body of water", "governing body", "eye of the storm", "plant cell", a family tree) are
 * taken out before matching. Nothing here changes what the writer sees.
 */
import { BASE_KIND } from "../library/catalogue";
import { asPicture, tilesAsPictures } from "./fallbacks";
import { normalise, tileDiagramKeys } from "./materialise";

type S = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Relationship structures: the people or animals in them are words in boxes, not bodies (a family
 * tree, a food chain, a probability tree). Such a figure is left to the drawer.
 */
const STRUCTURE =
  /\b(family (tree|map|diagram)|relationship (map|diagram)|food (chain|web)|(tree|probability|decision) diagram|probability tree|decision tree|organi[sz]ation chart|flow ?chart)\b/i;

/** Phrases that look like a body word but are not a living body. */
const NOT_A_BODY = [
  /\b(?:(?:animal|plant|human|body|blood|nerve|cheek|onion|root[- ]hair|red|white|sperm|egg|guard|palisade|muscle)\s+){0,2}cells?\b/gi,
  /\beye of (a|the) (storm|hurricane|cyclone|typhoon|needle)\b/gi,
  /\b(bird'?s|worm'?s)[- ]eye\b/gi,
  /\bnaked eye\b/gi,
  /\bears? of (wheat|corn|barley|rice|maize|grain|oats)\b/gi,
  /\bheart of\b/gi,
  /\b(power|treatment|processing|nuclear|chemical|bottling|desalination) plants?\b/gi,
  /\bplant (pot|food|label)s?\b/gi,
];

/** A person or people drawn (not a name in a box). */
const PEOPLE =
  /\b(human|humans|person|people|man|men|woman|women|boys?|girls?|child|children|teenagers?|teenage|baby|babies|toddlers?|pedestrians?|athletes?|runners?|swimmers?|soldiers?|legionar(y|ies)|knights?|portraits?|silhouettes?|stick figures?|(human|body) outline|body (shape|map)|whole body|human body|skeleton|skull)\b/i;
/** An animal drawn. */
const ANIMALS =
  /\b(animals?|mammals?|reptiles?|amphibians?|birds?|fish|frogs?|tadpoles?|toads?|newts?|insects?|butterfl(y|ies)|caterpillars?|ladybirds?|bees?|spiders?|worms?|snails?|dogs?|pupp(y|ies)|cats?|kittens?|horses?|foals?|cows?|calf|calves|sheep|lambs?|pigs?|piglets?|hens?|chicks?|chickens?|ducks?|ducklings?|goats?|rabbits?|foxes|fox|lions?|tigers?|elephants?|whales?|dolphins?|sharks?|owls?|dinosaurs?|snakes?|lizards?)\b/i;
/** A part of a living body. */
const BODY_PARTS =
  /\b(heart|lungs?|brain|kidneys?|liver|stomach|intestines?|digestive system|circulatory system|eyes?|ears?|wrists?|fingers?|fingertips?|tooth|teeth|muscles?)\b/i;
/** A whole plant. */
const PLANTS = /\b(plants?|flowers?|seedlings?|sunflowers?|trees?)\b/i;

/** Why `shows` is a living thing's body, or undefined when it is not. */
export function livingBodyOf(shows: string): string | undefined {
  if (STRUCTURE.test(shows)) return undefined;
  let t = shows;
  for (const re of NOT_A_BODY) t = t.replace(re, " ");
  for (const [why, re] of [
    ["person", PEOPLE],
    ["animal", ANIMALS],
    ["body part", BODY_PARTS],
    ["plant", PLANTS],
  ] as const) {
    const m = re.exec(t);
    if (m) return `${why}: ${m[0].toLowerCase()}`;
  }
  return undefined;
}

/** Library models that draw a body: on a side slot they would fall to a freehand drawing. */
const BODY_MODELS = new Set(["heart_circulation", "body_map"]);

/** True for a freeform labelled drawing of a living body. */
export const isFreehandBody = (f: unknown): boolean =>
  !!f &&
  typeof f === "object" &&
  (f as S).kind === "labelled-diagram" &&
  !!livingBodyOf(str((f as S).shows));

/**
 * True for a library model on a side slot that the drawer would draw freehand as a body (models
 * are full slides only, and a model with no base kind falls to a labelled drawing of its intent).
 */
const sideModelBody = (f: unknown, full: boolean): boolean => {
  if (full || !f || typeof f !== "object" || (f as S).kind !== "model") return false;
  const model = str((f as S).model);
  if (BASE_KIND[model]) return false;
  return BODY_MODELS.has(model) || !!livingBodyOf(str((f as S).intent));
};

/** True when a library model's labelled-drawing fallback would draw a body (no drawer call). */
export const fallbackIsBody = (model: string, intent: string): boolean =>
  !BASE_KIND[model] && (BODY_MODELS.has(model) || !!livingBodyOf(intent));

/**
 * The library model that draws a body, for a full slide: the heart and circulation model for the
 * heart with its blood, vessels or lungs; the body map for a whole body, its organs or skeleton.
 * Undefined when neither fits (an animal, a plant, an eye).
 */
export function bodyModelFor(shows: string): string | undefined {
  if (
    /\bheart\b/i.test(shows) &&
    /\b(blood|vessels?|circulat\w*|lungs?|arter\w*|veins?)\b/i.test(shows)
  )
    return "heart_circulation";
  if (
    /\b(human body|body outline|human outline|whole body|skeleton|muscles|digesti\w*|organs?)\b/i.test(
      shows,
    )
  )
    return "body_map";
  return undefined;
}

export type BodyRoute = {
  slide: S;
  /** What each rerouted figure became, for the log. */
  routes: { key: string; to: "model" | "picture"; why: string; model?: string }[];
};

/**
 * The slide with each freehand body rerouted (see the file note); the slide itself when it has
 * none, or when no route exists (a figure with nothing a picture could show stays as it was).
 * `models` are the library models this lesson's writer may use; a model only fills a full slide.
 */
export function routeFreehandBodies(raw: S, models: readonly string[]): BodyRoute {
  const routes: BodyRoute["routes"] = [];
  let s = raw;
  // The slide's own figure (a visual-text or big-visual figure, or a catalogue slot).
  for (const k of ["figure", "diagram"]) {
    const f = s[k] as S | undefined;
    const full = s.template === "big-visual" || s.template === "big-diagram";
    if (sideModelBody(f, full)) {
      const pic = asPicture(s);
      if (!pic) continue;
      s = pic;
      routes.push({ key: k, to: "picture", why: `side-slot model: ${str(f?.model)}` });
      continue;
    }
    if (!isFreehandBody(f)) continue;
    const why = livingBodyOf(str(f?.shows)) ?? "";
    const model = full ? bodyModelFor(str(f?.shows)) : undefined;
    if (model && models.includes(model)) {
      s = {
        ...s,
        [k]: { kind: "model", model, intent: str(f?.shows), alt: str(f?.shows) },
      };
      routes.push({ key: k, to: "model", why, model });
      continue;
    }
    const pic = asPicture(s);
    if (!pic) continue;
    s = pic;
    routes.push({ key: k, to: "picture", why });
  }
  // Tiles (a compare card's visual, a sequence stage): a picture of the same thing.
  const n = normalise(s);
  const tiles = tileDiagramKeys(s).filter((key) => {
    const m = /^(col|seq)\.(\d+)$/.exec(key);
    const i = Number(m?.[2]);
    const host =
      m?.[1] === "col" ? (n.columns as S[] | undefined)?.[i] : (n.sequence as S[] | undefined)?.[i];
    const f = m?.[1] === "col" ? host?.picture : host?.diagram;
    return isFreehandBody(f);
  });
  if (tiles.length) {
    const t = tilesAsPictures(s, tiles);
    if (t) {
      s = t;
      for (const key of tiles) routes.push({ key, to: "picture", why: "a body in a tile" });
    }
  }
  return { slide: s, routes };
}
