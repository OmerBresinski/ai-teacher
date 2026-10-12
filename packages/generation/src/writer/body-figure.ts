/**
 * No freehand bodies (TEACH-247 part ad, STICKFIG). The drawer names what a labelled drawing is of
 * (`subject` on the labelled-diagram spec); a `living_body` is never drawn from primitives, which
 * can only make a stick figure (`diagrams.ts` `isLivingBodySpec`). On a full slide the stage tries
 * these library models, in order, where the lesson's catalogue has them (a model's fill draws only
 * what it can show); otherwise the figure fails and the fallback ladder places a picture of the
 * same thing (`fallbacks.ts` `asPicture`, every label kept as what the picture must show).
 */
export const BODY_MODELS = ["heart_circulation", "body_map"] as const;
