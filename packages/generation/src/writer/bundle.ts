import base4Defs from "./bundles/base4/diagram-defs.gen.json" with { type: "json" };
import * as base4 from "./bundles/base4/prompts.gen";
import * as base4fP123 from "./bundles/base4f-p123/prompts.gen";

/*
 * The writer's prompt set as a named, versioned bundle (Greg, 8 Oct): every pinned file the
 * writer stage sends (system texts, schema inputs, repair, restage, notes, pupil wording,
 * objective repair, diagram spec) plus the pinned per-kind diagram defs. Production runs the one
 * bundle `WRITER_BUNDLE_ID` names. A new winner ships by adding its pinned files as a new bundle
 * folder, registering it below and changing `WRITER_BUNDLE_ID`; no stage code changes. Bundle
 * files are byte-exact copies of the lab's pinned files; `writer-prompts.test.ts` checks every
 * bundle's sha256 pins.
 */

/** Every bundle's files as strings (each generated module types its own bytes as literals). */
type Prompts = {
  [K in keyof typeof base4]: K extends "WRITER_PROMPT_SHA256"
    ? Record<keyof (typeof base4)[K], { file: string; sha256: string; pinned: boolean }>
    : string;
};
export type WriterBundle = Omit<Prompts, "WRITER_PROMPT_SHA256"> & {
  id: string;
  /** sha256 of each file as pinned in the lab. */
  pins: Prompts["WRITER_PROMPT_SHA256"];
  /** The writer hash (system text and schema, 3 stages) the evidence registry pins. */
  tHash: string;
  /** Per-kind diagram defs the schema builder splices in, by stage, in the pinned order. */
  diagramDefs: Record<string, unknown>;
};

const bundle = (
  id: string,
  p: Prompts,
  tHash: string,
  diagramDefs: Record<string, unknown>,
): WriterBundle => {
  const { WRITER_PROMPT_SHA256, ...files } = p;
  return { ...files, id, pins: WRITER_PROMPT_SHA256, tHash, diagramDefs };
};

export const WRITER_BUNDLES = {
  base4: bundle("base4", base4, "18057b0c7aa8", base4Defs),
  // base4 with three system lines (the recall opener asks what pupils already know; tasks use only
  // what the lesson teaches or pupils know; at least one hinge slide). Same schema and defs.
  "base4f-p123": bundle("base4f-p123", base4fP123, "8a0f9b4f6dde", base4Defs),
} as const satisfies Record<string, WriterBundle>;
export type WriterBundleId = keyof typeof WRITER_BUNDLES;

/** The writer prompt set production ships: the one value to change when a new winner lands. */
export const WRITER_BUNDLE_ID: WriterBundleId = "base4f-p123";

export const writerBundle = (id: WriterBundleId = WRITER_BUNDLE_ID): WriterBundle =>
  WRITER_BUNDLES[id];
