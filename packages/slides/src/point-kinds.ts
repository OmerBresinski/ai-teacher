import type { CalloutKind, Theme } from "@tj/domain/documents";
import { type CalloutTone, calloutTones } from "./themes";

/*
 * Kept apart from `callout.ts` so the templates (and the worksheet print chunk that pulls them in)
 * load only these few constants, not the callout layout code (TEACH-75 part e, bundle budget).
 */

/**
 * The drawn icon each kind carries (lucide names from the editor's icon set), drawn in the kind's
 * colour rather than set as emoji: Chalkie's warning sign for a common mistake; a lightbulb for
 * an example and an open book for key words, where Chalkie has a magnifier and a key (review
 * T75-7: the idea and the vocabulary read faster than the tools).
 */
export const CALLOUT_ICONS: Record<CalloutKind, string> = {
  "watch-out": "triangle-alert",
  example: "lightbulb",
  "key-words": "book-open",
};

/*
 * Typed callouts on a template key card (UX ruling 203, P1; TEACH-75 part e). The writer may type
 * one support point as a callout: Remember, Watch out (a misconception), Key point, Example or
 * Fun fact. The card is the key card the lead + points column and ruling 194's strip already set,
 * tinted per type with an icon at the head of its label row. The three kinds ruling 84 already
 * tunes per theme keep those tones and icons (watch-out, example, and key-words for a key point);
 * Remember (blue) and Fun fact (lilac) have their own rows in `CALLOUT_TONES`. A point with no type is the key card as before.
 */
export const POINT_KINDS = ["remember", "watch-out", "key-point", "example", "fun-fact"] as const;
export type PointKind = (typeof POINT_KINDS)[number];
export const isPointKind = (v: unknown): v is PointKind =>
  typeof v === "string" && (POINT_KINDS as readonly string[]).includes(v);

/** The label a typed card shows when the point has none of its own. */
export const POINT_KIND_LABELS: Record<PointKind, string> = {
  remember: "Remember",
  "watch-out": "Watch out",
  "key-point": "Key point",
  example: "Example",
  "fun-fact": "Fun fact",
};

/**
 * The drawn icon per type: ruling 84's icons for the kinds it shares (`CALLOUT_ICONS`), so a card
 * looks the same whichever path draws it, plus a brain for Remember and sparkles for Fun fact.
 */
export const POINT_KIND_ICONS: Record<PointKind, string> = {
  remember: "brain",
  "watch-out": CALLOUT_ICONS["watch-out"],
  "key-point": CALLOUT_ICONS["key-words"],
  example: CALLOUT_ICONS.example,
  "fun-fact": "sparkles",
};

/** The tone a typed card takes on theme `t`. */
/**
 * Remember (blue) and Fun fact (lilac) tones per theme (UX ruling 203, P1), hand-set the way
 * `CALLOUT_TONES` is; here, not in themes.ts, so only the templates load them.
 */
export const POINT_TONES: Record<string, Record<"remember" | "fun-fact", CalloutTone>> = {
  chalk: {
    remember: { fill: "#DBDFDE", line: "#A2B8CF", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#E6DBDD", line: "#C1ACCD", ink: "#301C4C", icon: "#6B3FA8" },
  },
  playground: {
    remember: { fill: "#E0E1D4", line: "#A5BAC8", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#EADCD3", line: "#C4ADC6", ink: "#301C4C", icon: "#6B3FA8" },
  },
  crayon: {
    remember: { fill: "#E0E7ED", line: "#A5BED9", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#EAE2EC", line: "#C4B1D7", ink: "#301C4C", icon: "#6B3FA8" },
  },
  splash: {
    remember: { fill: "#D0E3F1", line: "#9BBBDC", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#DBDEF0", line: "#B9AEDA", ink: "#301C4C", icon: "#6B3FA8" },
  },
  treehouse: {
    remember: { fill: "#D4E2E1", line: "#9DBAD2", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#DEDDE1", line: "#BBADD0", ink: "#301C4C", icon: "#6B3FA8" },
  },
  studio: {
    remember: { fill: "#D9E3F0", line: "#A1BBDC", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#E3DFEF", line: "#BFAFDA", ink: "#301C4C", icon: "#6B3FA8" },
  },
  "reading-room": {
    remember: { fill: "#D6DBDE", line: "#9FB5CF", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#E1D6DD", line: "#BDA9CD", ink: "#301C4C", icon: "#6B3FA8" },
  },
  "exam-hall": {
    remember: { fill: "#E0E9F4", line: "#A5BFDE", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#EAE4F3", line: "#C4B2DC", ink: "#301C4C", icon: "#6B3FA8" },
  },
  "night-lab": {
    remember: { fill: "#162A42", line: "#193A63", ink: "#D2DFEF", icon: "#9AB7DA" },
    "fun-fact": { fill: "#2C2141", line: "#3F2A61", ink: "#E1D9EE", icon: "#BCA9D8" },
  },
  beacon: {
    remember: { fill: "#E0E7E8", line: "#1F5FAD", ink: "#0E2B4E", icon: "#1F5FAD" },
    "fun-fact": { fill: "#EAE2E8", line: "#6B3FA8", ink: "#301C4C", icon: "#6B3FA8" },
  },
};

export function pointTone(t: Theme, kind: PointKind): CalloutTone {
  if (kind === "remember" || kind === "fun-fact") {
    const row = POINT_TONES[t.id] ?? POINT_TONES[t.dark ? "night-lab" : "chalk"];
    return (row as Record<"remember" | "fun-fact", CalloutTone>)[kind];
  }
  return calloutTones(t)[kind === "key-point" ? "key-words" : kind];
}
