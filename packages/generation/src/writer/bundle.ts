import base4Defs from "./bundles/base4/diagram-defs.gen.json" with { type: "json" };
import * as base4 from "./bundles/base4/prompts.gen";
import * as base4fP123 from "./bundles/base4f-p123/prompts.gen";
import * as base4g from "./bundles/base4g/prompts.gen";

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
  /** Stage behaviour a bundle's wording relies on, switched with it (absent: off). */
  features?: BundleFeatures;
};
export type BundleFeatures = {
  /** Slot-fill (slot-fill.ts): per-fit slide defs with caps, Fits lines as word budgets. */
  slotFill?: boolean;
  /** The objectives call picks the theme (ruling 202), so the writer's `design` has no theme. */
  planTheme?: boolean;
};

const bundle = (
  id: string,
  p: Prompts,
  tHash: string,
  diagramDefs: Record<string, unknown>,
  features?: BundleFeatures,
): WriterBundle => {
  const { WRITER_PROMPT_SHA256, ...files } = p;
  return {
    ...files,
    id,
    pins: WRITER_PROMPT_SHA256,
    tHash,
    diagramDefs,
    ...(features ? { features } : {}),
  };
};

export const WRITER_BUNDLES = {
  base4: bundle("base4", base4, "18057b0c7aa8", base4Defs),
  // base4 with three system lines (the recall opener asks what pupils already know; tasks use only
  // what the lesson teaches or pupils know; at least one hinge slide). Same schema and defs.
  "base4f-p123": bundle("base4f-p123", base4fP123, "8a0f9b4f6dde", base4Defs),
  // base4f-p123 with slot-fill (lab/slotfill round 2), anatomy routed to a flow, cycle or picture,
  // the curriculum statements and the theme in the objectives call, and the practice example cut.
  // Its line edits are listed in base4g.test.ts (SYSTEM_EDITS). Production switches by WRITER_BUNDLE_ID.
  base4g: bundle("base4g", base4g, "2e5d71686b35", base4Defs, { slotFill: true, planTheme: true }),
} as const satisfies Record<string, WriterBundle>;
export type WriterBundleId = keyof typeof WRITER_BUNDLES;

/** The writer prompt set production ships: the one value to change when a new winner lands. */
export const WRITER_BUNDLE_ID: WriterBundleId = "base4f-p123";

/**
 * True when the process may be deployed: any Railway variable (every Railway environment, staging
 * and PR ones included) or NODE_ENV=production. Fails closed: the lab is only a local process.
 */
export function isDeployedEnv(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production" || Object.keys(env).some((k) => k.startsWith("RAILWAY_"));
}

/**
 * The bundle this process runs. `WRITER_BUNDLE_ID` unless the parity lab declares a candidate:
 * `LAB_WRITER_BUNDLE_ID` is honoured only with the lab marker `LAB_PARITY=1` (exactly), no
 * `RAILWAY_*` variable at all and NODE_ENV not `production`; otherwise it is ignored with a
 * warning. An unknown id in the lab throws, so a typo never runs as a silent production lesson.
 * The warning fires only when LAB_WRITER_BUNDLE_ID is set, which no deployed service does.
 */
export function resolveWriterBundleId(
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = console.warn,
): WriterBundleId {
  const want = env.LAB_WRITER_BUNDLE_ID?.trim();
  if (!want) return WRITER_BUNDLE_ID;
  if (isDeployedEnv(env)) {
    warn(
      `LAB_WRITER_BUNDLE_ID=${want} ignored outside the local lab; writer bundle ${WRITER_BUNDLE_ID}`,
    );
    return WRITER_BUNDLE_ID;
  }
  if (env.LAB_PARITY !== "1") {
    warn(
      `LAB_WRITER_BUNDLE_ID=${want} ignored without LAB_PARITY=1; writer bundle ${WRITER_BUNDLE_ID}`,
    );
    return WRITER_BUNDLE_ID;
  }
  if (!(want in WRITER_BUNDLES)) {
    throw new Error(
      `LAB_WRITER_BUNDLE_ID=${want} is not a writer bundle (${Object.keys(WRITER_BUNDLES).join(", ")})`,
    );
  }
  warn(`lab candidate: writer bundle ${want} (production ships ${WRITER_BUNDLE_ID})`);
  return want as WriterBundleId;
}

/** The bundle this process runs: `WRITER_BUNDLE_ID`, or the lab's declared candidate. */
export const ACTIVE_WRITER_BUNDLE_ID: WriterBundleId = resolveWriterBundleId();

export const writerBundle = (id: WriterBundleId = ACTIVE_WRITER_BUNDLE_ID): WriterBundle =>
  WRITER_BUNDLES[id];
