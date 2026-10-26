import { ICON_CONCEPTS, resolveIcon } from "@tj/slides/icons";
import b1 from "./bundles/pilot-v4.4/base-KS1.schema.json" with { type: "json" };
import b2 from "./bundles/pilot-v4.4/base-KS2.schema.json" with { type: "json" };
import b3 from "./bundles/pilot-v4.4/base-KS3.schema.json" with { type: "json" };
import l44 from "./bundles/pilot-v4.4/layouts.json" with { type: "json" };
import s1 from "./bundles/pilot-v4.4/system-KS1.txt" with { type: "text" };
import s2 from "./bundles/pilot-v4.4/system-KS2.txt" with { type: "text" };
import s3 from "./bundles/pilot-v4.4/system-KS3.txt" with { type: "text" };
import b51 from "./bundles/pilot-v4.5/base-KS1.schema.json" with { type: "json" };
import b52 from "./bundles/pilot-v4.5/base-KS2.schema.json" with { type: "json" };
import b53 from "./bundles/pilot-v4.5/base-KS3.schema.json" with { type: "json" };
import l45 from "./bundles/pilot-v4.5/layouts.json" with { type: "json" };
import s51 from "./bundles/pilot-v4.5/system-KS1.txt" with { type: "text" };
import s52 from "./bundles/pilot-v4.5/system-KS2.txt" with { type: "text" };
import s53 from "./bundles/pilot-v4.5/system-KS3.txt" with { type: "text" };
import b61 from "./bundles/pilot-v4.6/base-KS1.schema.json" with { type: "json" };
import b62 from "./bundles/pilot-v4.6/base-KS2.schema.json" with { type: "json" };
import b63 from "./bundles/pilot-v4.6/base-KS3.schema.json" with { type: "json" };
import l46 from "./bundles/pilot-v4.6/layouts.json" with { type: "json" };
import s61 from "./bundles/pilot-v4.6/system-KS1.txt" with { type: "text" };
import s62 from "./bundles/pilot-v4.6/system-KS2.txt" with { type: "text" };
import s63 from "./bundles/pilot-v4.6/system-KS3.txt" with { type: "text" };
import l47 from "./bundles/pilot-v4.7/layouts.json" with { type: "json" };
import s71 from "./bundles/pilot-v4.7/system-KS1.txt" with { type: "text" };
import s72 from "./bundles/pilot-v4.7/system-KS2.txt" with { type: "text" };
import s73 from "./bundles/pilot-v4.7/system-KS3.txt" with { type: "text" };
import t81 from "./bundles/pilot-v4.8-menu/system-KS1.template.txt" with { type: "text" };
import t82 from "./bundles/pilot-v4.8-menu/system-KS2.template.txt" with { type: "text" };
import t83 from "./bundles/pilot-v4.8-menu/system-KS3.template.txt" with { type: "text" };
import t91 from "./bundles/pilot-v4.9-menu/system-KS1.template.txt" with { type: "text" };
import t92 from "./bundles/pilot-v4.9-menu/system-KS2.template.txt" with { type: "text" };
import t93 from "./bundles/pilot-v4.9-menu/system-KS3.template.txt" with { type: "text" };
import t101 from "./bundles/pilot-v4.10-menu/system-KS1.template.txt" with { type: "text" };
import t102 from "./bundles/pilot-v4.10-menu/system-KS2.template.txt" with { type: "text" };
import t103 from "./bundles/pilot-v4.10-menu/system-KS3.template.txt" with { type: "text" };
import t111 from "./bundles/pilot-v4.11-menu/system-KS1.template.txt" with { type: "text" };
import t112 from "./bundles/pilot-v4.11-menu/system-KS2.template.txt" with { type: "text" };
import t113 from "./bundles/pilot-v4.11-menu/system-KS3.template.txt" with { type: "text" };
import t121 from "./bundles/pilot-v4.12-menu/system-KS1.template.txt" with { type: "text" };
import t122 from "./bundles/pilot-v4.12-menu/system-KS2.template.txt" with { type: "text" };
import t123 from "./bundles/pilot-v4.12-menu/system-KS3.template.txt" with { type: "text" };
import t131 from "./bundles/pilot-v4.13-menu/system-KS1.template.txt" with { type: "text" };
import t132 from "./bundles/pilot-v4.13-menu/system-KS2.template.txt" with { type: "text" };
import t133 from "./bundles/pilot-v4.13-menu/system-KS3.template.txt" with { type: "text" };
import t141 from "./bundles/pilot-v4.14-menu/system-KS1.template.txt" with { type: "text" };
import t142 from "./bundles/pilot-v4.14-menu/system-KS2.template.txt" with { type: "text" };
import t143 from "./bundles/pilot-v4.14-menu/system-KS3.template.txt" with { type: "text" };
import t151 from "./bundles/pilot-v4.15-menu/system-KS1.template.txt" with { type: "text" };
import t152 from "./bundles/pilot-v4.15-menu/system-KS2.template.txt" with { type: "text" };
import t153 from "./bundles/pilot-v4.15-menu/system-KS3.template.txt" with { type: "text" };
import t161 from "./bundles/pilot-v4.16-menu/system-KS1.template.txt" with { type: "text" };
import t162 from "./bundles/pilot-v4.16-menu/system-KS2.template.txt" with { type: "text" };
import t163 from "./bundles/pilot-v4.16-menu/system-KS3.template.txt" with { type: "text" };
import { withWriterTemplates } from "./diagrams";
import { droppedFits, headingWords, withFits } from "./fit-fits";
import {
  assembleWriterSystem,
  layoutFieldCaps,
  questionFieldCaps,
  questionOffer,
} from "./layout-menu";
import type { WriterStage } from "./schema";
import { measuredFitDefs } from "./slot-fill";
import { WAVE_C_FLOW_SHAPES, WAVE_C_ROUTED_FITS, waveCDefs, waveCWordCaps } from "./wave-c";

/*
 * The pilot writer pack (TEACH-110 part s): the menu and schema the prompt-engineer generates
 * (pilot/writer/MENU-v<n>.md, schema-v<n>.json) and the base schema and system text they were
 * written for, as byte-exact files. `pilotRequest` builds the writer's request the way the real
 * writer smokes did (smoke-real4/run.ts): base schema + library models + production's per-lesson
 * flow parts, the pack's flow shapes, its layouts spliced in and its retired layouts removed. No
 * words of the menu are written here; a new version is a new folder and one line below.
 */
type J = Record<string, any>;
type Ks = "KS1" | "KS2" | "KS3";
export type PilotPack = {
  id: string;
  layouts: {
    flowShapes: string[];
    retired: string[];
    stages: Record<string, { $defs: J }>;
    /** JSON pointers into the base schema and the node each one becomes (v4.5 on). */
    basePatches?: J;
    /** Base defs a pack layout replaces, by exact key, removed before the pack's defs go in (v4.7). */
    replaced?: string[];
    /** A flow item's size, how much the slide says, written before `teaches` (TEACH-110 part aa). */
    flowSize?: J;
  };
  base: Record<Ks, J>;
  system: Record<Ks, string>;
  /**
   * No string caps reach a model (v4.6 on): Sol's strict decoder obeys a `maxLength` by stopping
   * the string mid-word. Code checks the caps instead, from `capsFrom`'s request.
   */
  uncapped?: boolean;
  /** The pack whose request carries the caps code checks against (slot-fill's cap table). */
  capsFrom?: string;
  /**
   * Wave C is offered (TEACH-110 part v, v4.8): its defs (`waveCDefs`), its word caps in the caps
   * request (`waveCWordCaps`), and the library line that lets figure-slide and step-model take a
   * model (`withWaveCLibrary`, stage.ts). Its menu lines are the template's `{{menu:wave-c}}`.
   */
  waveC?: boolean;
  /**
   * Fits routed to a wave C layout, by exact def key, never sent: the work goes where the menu
   * says (two pictures to split-compare; a calculation with no figure to worked, gold-equal).
   */
  routedFits?: readonly string[];
  /** The question layouts' defs come from the capacity tables (`questionDefs`, v4.7 on). */
  questionDefs?: boolean;
  /** `layout-icon` is built per request from the matcher's catalogue (`layoutIconDef`, v4.7 on). */
  catalogueIcons?: boolean;
  /** Fits not offered at the floor or past a cliff leave the schema too (`droppedFits`, v4.8). */
  fitFloor?: boolean;
  /**
   * Each flow entry names its slide's layout and fit (`layout`, before `size`), so the fit is
   * chosen and the idea counted against it while a split is still possible (loop 1b, v4.8).
   */
  flowLayout?: boolean;
  /**
   * `slides` takes the production schema's bounds, as `flow` does (v4.9, TEACH-110 part aq). The
   * pack bases fix `slides` at 7..10 for every tier (6..9 once `close` takes one), so every lesson
   * was 9 to 12 slides long: a
   * Detailed plan of 13 had to close early and its flow entries stopped matching its slides.
   */
  tierSlides?: boolean;
  /**
   * The reasons slide offers one optional question picture (`picture`, TEACH-247 part ba), checked
   * against the picture cells (reasons-picture-capacity.json). Only with menu wording that offers it.
   */
  reasonsPicture?: boolean;
  /**
   * The writer specs the river and hydrograph templates itself (`withWriterTemplates`), as it
   * did in the early-Oct lab runs, instead of naming them `{kind, shows, labels}` for the drawer.
   * A spec that does not parse or fit still goes to the drawer (TEACH-247 part bb).
   */
  writerTemplates?: boolean;
};

/** v4.8's flow `size`: the words the idea needs, counted against the fit its `layout` names. */
const FLOW_SIZE_COUNTED = {
  type: "string",
  description:
    "the words the idea needs, counted from the idea: how many items, the words each item needs out of its fit's words, then the lead's or stem's words out of its fit's",
};

/** A flow entry's `layout` value for a slide def key: `visual-text~points-2-fig` → `visual-text points-2-fig`. */
export const flowLayoutOf = (defKey: string): string => defKey.replace("~", " ");

/**
 * A pack's layouts without the pilot's word `budgets` (with their `charCaps`; layouts.json, v4.4-era
 * numbers that drifted from the menu: KS2 three sides 12 against 13). The menu constants
 * (layout-menu.ts, from the measured capacity tables) are the one source of every word budget the
 * writer reads and code checks; nothing may read the stale copy (18 Oct 2026).
 */
function menuFed(l: unknown): PilotPack["layouts"] {
  const { budgets: _b, ...rest } = l as Record<string, unknown>;
  return rest as unknown as PilotPack["layouts"];
}

export const PILOT_PACKS = {
  "v4.4": {
    id: "v4.4",
    layouts: l44 as PilotPack["layouts"],
    base: { KS1: b1, KS2: b2, KS3: b3 },
    system: { KS1: s1, KS2: s2, KS3: s3 },
  },
  // v4.5: answers count from 1 (the hinge writes its correct option first), a compact JSON and a
  // short flow before slide 1, set vs contrast by content (MENU-v4.5.md, build/HINGE-ANSWER.md).
  "v4.5": {
    id: "v4.5",
    layouts: l45 as PilotPack["layouts"],
    base: { KS1: b51, KS2: b52, KS3: b53 },
    system: { KS1: s51, KS2: s52, KS3: s53 },
  },
  // v4.6: no maxLength or pattern anywhere a model reads (writer and repairs); v4.5's prose,
  // budgets and charCaps byte for byte (MENU-v4.6.md). Bases arrive patched and stripped.
  "v4.6": {
    id: "v4.6",
    layouts: l46 as PilotPack["layouts"],
    base: { KS1: b61, KS2: b62, KS3: b63 },
    // Frozen as shipped (the snapshot `assembleWriterSystem` made on 15 Oct): v4.7 now owns the
    // menu constants.
    system: { KS1: s61, KS2: s62, KS3: s63 },
    uncapped: true,
    capsFrom: "v4.5",
  },
  // v4.7 (TEACH-110 part v): the question layouts as one def each (hinge, quick check, practice,
  // exit ticket) with their answers, choose retired into the hinge (ruling 230), items-row parts
  // only (ruling 227) and the contrast, parts and set boundaries stated at the flow step.
  "v4.7": {
    id: "v4.7",
    layouts: menuFed(l47),
    base: { KS1: b61, KS2: b62, KS3: b63 },
    // Frozen as shipped (master's `pilot-v4.7-menu` snapshot after #582, 18 Oct): v4.8 now owns
    // the menu constants.
    system: { KS1: s71, KS2: s72, KS3: s73 },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
  },
  // v4.8 (TEACH-110 part ae, build/CRAMMING-ROOT-CAUSE.md): v4.7 with a Fits number stated as a
  // ceiling, not a target (step 4); the plan near the low end of a range so a split has room
  // (ruling 261); and the list and contrast layouts' text length generated from their budgets.
  "v4.8": {
    id: "v4.8",
    // A why shape, so reasons is reachable by its own shape (wave C).
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    // The layouts' menu lines come from the menu constants (layout-menu.ts), whose numbers are
    // the measured capacity tables; the rest of the text is the pack's, byte for byte.
    // The fit layouts' Fits and the heading's words come from code too (`withFits`, loop 1).
    system: {
      KS1: withFits(assembleWriterSystem(t81, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t82, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t83, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
  },
  // v4.9 (TEACH-110 part aq): v4.8 with the slides its plan lists. Each tier's slide bounds reach
  // `slides` (`tierSlides`), and step 3 writes one slide per flow entry, in order, ending at its
  // last; the count line counts the close. A picture's named vs generic subject gains examples
  // (ruling 296: an ordinary object of a period is generic). Templates differ from v4.8 in those
  // three lines only.
  "v4.9": {
    id: "v4.9",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t91, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t92, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t93, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.10 (TEACH-110 part ar): v4.9 with pupil-facing wording. Lines are whole, natural sentences
  // for the age (no semicolons at KS1 and KS2), and an idea that will not fit takes a roomier fit
  // rather than a squeezed sentence; a teaching slide ends on its explanation, not a bare command;
  // each question asks something new and practice applies rather than restates; a wrong option is
  // one a half-learned pupil would pick. Schema and code as v4.9; templates differ in 3 lines.
  "v4.10": {
    id: "v4.10",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t101, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t102, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t103, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.11 (TEACH-110 part as): v4.10 with whole questions and 3-option hinges for the young. A
  // question never ends on a clipped second command ("Explain.", "Include ..."), the exit ticket
  // included, and an exit question covering two objectives is one whole question; a KS1 hinge
  // takes 3 short-phrase options (Years 3 and 4 at KS2 take 3, ruling 147) and every hinge has the
  // option count its flow size names. Schema and code as v4.10; templates differ in 1 line.
  "v4.11": {
    id: "v4.11",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t111, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t112, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t113, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.12 (TEACH-110 part at): v4.11 with fuller teaching slides, plain recall, plausible wrong
  // options, varied question openings and a reconstruction marked generic. A teaching slide states
  // its point's core facts with one concrete detail; a recall question asks plainly; every wrong
  // option is a half-learned answer; "imagine"-type openers at most once a lesson; a scene or
  // reconstruction at a real place is a generic picture (ruling 210). Schema and code as v4.11;
  // templates differ in 5 lines.
  "v4.12": {
    id: "v4.12",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t121, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t122, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t123, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.13 (TEACH-110 part au): v4.12 with no repeat slides, named people and clear questions. A
  // picture is new only when it shows a case, place or stage no earlier slide showed, and two
  // teaching slides never teach the same point; a reason involving people names who they were;
  // a question asks one clear thing. Schema and code as v4.12; templates differ in 2 lines.
  "v4.13": {
    id: "v4.13",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t131, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t132, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t133, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.14 (TEACH-110 part av): v4.13 with taught answers and lighter KS1 slides. Every question's
  // answer is stated in an earlier slide's text, not only in the notes or a picture; in Years 1
  // and 2 a teaching slide's words are at most two short sentences. Schema and code as v4.13;
  // templates differ in 1 line (KS2, KS3) or 2 (KS1).
  "v4.14": {
    id: "v4.14",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t141, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t142, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t143, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.15 (TEACH-251 part aj): v4.14 with picture asks that can be placed. Parts that are each a
  // real building, structure or site take panel-list with a named picture per item (items-row has
  // no pictures); a surviving monument or any part of it is never reconstructed, only its remains
  // by name (ruling 296); a library map's intent gives a span of years, never one year as both
  // ends. Schema and code as v4.14; templates differ in 3 lines.
  "v4.15": {
    id: "v4.15",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t151, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t152, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t153, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
  // v4.16 (TEACH-251 part aq): v4.15 with sharper shape reading in the flow step. The reasons
  // that answer one why or how question are one slide, never a slide a reason; two cases set side
  // by side are a contrast with a picture per side, never one picture of both; a point about where
  // something is or was looks at a map (a library map model, else a picture of a map); a check
  // asks for an answer no earlier check asked for. No quotas or caps (rulings of 10 Oct). Schema
  // and code as v4.15; templates differ in 2 lines.
  "v4.16": {
    id: "v4.16",
    layouts: { ...menuFed(l47), flowShapes: WAVE_C_FLOW_SHAPES, flowSize: FLOW_SIZE_COUNTED },
    base: { KS1: b61, KS2: b62, KS3: b63 },
    system: {
      KS1: withFits(assembleWriterSystem(t161, "KS1"), "KS1", WAVE_C_ROUTED_FITS),
      KS2: withFits(assembleWriterSystem(t162, "KS2"), "KS2", WAVE_C_ROUTED_FITS),
      KS3: withFits(assembleWriterSystem(t163, "KS3-5"), "KS3-5", WAVE_C_ROUTED_FITS),
    },
    uncapped: true,
    capsFrom: "v4.5",
    questionDefs: true,
    catalogueIcons: true,
    fitFloor: true,
    flowLayout: true,
    waveC: true,
    routedFits: WAVE_C_ROUTED_FITS,
    tierSlides: true,
  },
} as const satisfies Record<string, PilotPack>;
export type PilotPackId = keyof typeof PILOT_PACKS;
/** The pack production runs (TEACH-110 part s): stages/write.ts passes it to runWriter. */
export const PILOT_PACK_ID: PilotPackId = "v4.16";

/**
 * A schema with no string length caps: `maxLength` dropped, a `pattern` (the `^.{1,N}$` caps)
 * becomes `minLength: 1`. Item counts, enums and integer bounds stay: they never cut a string.
 */
export function stripStringCaps<T>(node: T): T {
  if (Array.isArray(node)) return node.map(stripStringCaps) as T;
  if (!node || typeof node !== "object") return node;
  const out: J = {};
  for (const [k, v] of Object.entries(node as J)) {
    if (k === "maxLength") continue;
    if (k === "pattern" && typeof v === "string") {
      out.minLength = 1;
      continue;
    }
    out[k] = k === "$comment" ? v : stripStringCaps(v);
  }
  return out as T;
}

/** A pack's base patches: each JSON pointer's node replaced; a pointer that is not there throws. */
export function withPatches(base: J, patches: J | undefined): J {
  for (const [ptr, node] of Object.entries(patches ?? {})) {
    if (!ptr.startsWith("/")) continue; // "$comment"
    const keys = ptr
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    const last = keys.pop() as string;
    const at = keys.reduce<J | undefined>((o, k) => o?.[k], base);
    if (!at || !(last in at)) throw new Error(`pilot pack: no ${ptr} in the base schema`);
    at[last] = structuredClone(node);
  }
  return base;
}

const ksOf = (stageKey: string): Ks =>
  stageKey === "KS1" || stageKey === "KS2" ? stageKey : "KS3";
const isLayout = (d: J) => typeof d?.properties?.template === "object";

/**
 * The writer's schema and system text from a pack. `prod` is production's schema for this lesson
 * (its flow length and `teaches` enum are per lesson); `withLibrary` adds the library models as
 * production does (`libSchema`).
 */
export function pilotRequest(
  id: PilotPackId,
  stageKey: string,
  prod: J,
  withLibrary: (schema: J) => J,
): { schema: J; system: string; caps?: J } {
  const pack: PilotPack = PILOT_PACKS[id];
  const ks = ksOf(stageKey);
  const schema = structuredClone(
    withLibrary(withPatches(structuredClone(pack.base[ks]), pack.layouts.basePatches)),
  ) as J;
  const fp = schema.properties.flow;
  const pf = prod.properties?.flow;
  if (pf) {
    fp.minItems = pf.minItems;
    fp.maxItems = pf.maxItems;
    fp.items.properties.teaches = pf.items.properties.teaches;
  }
  const ps = prod.properties?.slides;
  if (pack.tierSlides && ps) {
    schema.properties.slides.minItems = ps.minItems;
    schema.properties.slides.maxItems = ps.maxItems;
  }
  fp.items.properties.shape.enum = [...pack.layouts.flowShapes];
  if (pack.layouts.flowSize) {
    // Sized at planning, so the layout step picks a fit that holds it (never squeezed at writing).
    const { teaches, ...rest } = fp.items.properties;
    fp.items.properties = { ...rest, size: pack.layouts.flowSize, teaches };
    fp.items.required = [
      ...fp.items.required.filter((k: string) => k !== "teaches"),
      "size",
      "teaches",
    ];
  }
  const replaced = new Set(pack.layouts.replaced ?? []);
  for (const k of replaced) delete schema.$defs[k];
  const defs = {
    ...(pack.layouts.stages[ks === "KS3" ? "KS3-5" : ks]?.$defs ?? {}),
    ...(pack.questionDefs ? questionDefs(writerStageOf(ks)) : {}),
    ...(pack.catalogueIcons ? { "layout-icon": layoutIconDef() } : {}),
    ...(pack.waveC
      ? waveCDefs(writerStageOf(ks), !!schema.$defs["dg-model-full"], !!pack.reasonsPicture)
      : {}),
  };
  const refs = (schema.properties.slides.items.anyOf as J[]).filter(
    (r) => !replaced.has(String(r.$ref).split("/").pop() ?? ""),
  );
  for (const [k, d] of Object.entries(defs)) {
    schema.$defs[k] = d;
    // Shared defs (the icon names) are referenced by the layouts, never offered as a slide.
    if (isLayout(d) && !refs.some((r) => r.$ref === `#/$defs/${k}`))
      refs.push({ $ref: `#/$defs/${k}` });
  }
  const floored = new Set([
    ...(pack.fitFloor ? droppedFits(writerStageOf(ks)) : []),
    ...(pack.routedFits ?? []),
  ]);
  const gone = (k: string) =>
    floored.has(k) || pack.layouts.retired.includes(k.split("~")[0] as string);
  if (schema.properties.title?.anyOf)
    schema.properties.title.anyOf = (schema.properties.title.anyOf as J[]).filter(
      (r) => !gone(String(r.$ref).split("/").pop() ?? ""),
    );
  for (const k of Object.keys(schema.$defs)) if (gone(k)) delete schema.$defs[k];
  schema.properties.slides.items.anyOf = refs.filter(
    (r) => !gone(String(r.$ref).split("/").pop() ?? ""),
  );
  if (pack.flowLayout) {
    // The layouts a slide may take, as the flow names them; slides 1 and 2 are the title and
    // the objectives. Placed before `size`, so the idea is counted against the fit it names.
    const offered = (schema.properties.slides.items.anyOf as J[]).map((r) =>
      flowLayoutOf(String(r.$ref).split("/").pop() ?? ""),
    );
    const layout = {
      type: "string",
      description: "the layout and fit this slide is written in (the Layout step)",
      enum: ["title", "objectives", ...offered],
    };
    const { size, ...rest } = fp.items.properties;
    const before = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "teaches"));
    fp.items.properties = { ...before, layout, ...(size ? { size } : {}), teaches: rest.teaches };
    const req = (fp.items.required as string[]).filter((k) => k !== "layout");
    const at = req.indexOf(size ? "size" : "teaches");
    fp.items.required = [...req.slice(0, at), "layout", ...req.slice(at)];
  }
  if (pack.writerTemplates) Object.assign(schema, withWriterTemplates(schema, writerStageOf(ks)));
  // Nothing a pack replaced or retired may still be reachable: the writer would use it.
  const sent = JSON.stringify(schema);
  for (const k of [...replaced, ...pack.layouts.retired, ...floored])
    if (sent.includes(`"#/$defs/${k}"`) || sent.includes(`"#/$defs/${k}~`))
      throw new Error(`pilot pack ${id}: ${k} is still reachable`);
  if (pack.uncapped) {
    // The other layouts' caps come from the capped pack (production's library models still cap
    // their strings); the pilot layouts' caps come from the measured tables, as the menu's do.
    const capped = pack.capsFrom
      ? pilotRequest(pack.capsFrom as PilotPackId, stageKey, prod, withLibrary).schema
      : undefined;
    const caps = capped
      ? {
          ...capped,
          $defs: {
            ...capped.$defs,
            ...measuredFitDefs(capped.$defs as Record<string, J>, writerStageOf(ks)),
            ...capPilotDefs(schema.$defs, writerStageOf(ks)),
            ...(pack.waveC
              ? waveCWordCaps(schema.$defs, writerStageOf(ks), headingWords(writerStageOf(ks)))
              : {}),
          },
        }
      : undefined;
    if (caps && pack.writerTemplates)
      Object.assign(caps, withWriterTemplates(caps, writerStageOf(ks)));
    return { schema: stripStringCaps(schema), system: pack.system[ks], ...(caps ? { caps } : {}) };
  }
  return { schema, system: pack.system[ks] };
}

/**
 * The icon names a writer may use (TEACH-110 part x): every concept label the matcher knows
 * (`@tj/slides/icons` ICON_CONCEPTS, the pilot set and LAYOUT_CONCEPTS), lower case, in catalogue
 * order. Built per request, so a concept added to the library reaches the writer with no pack edit.
 */
export function layoutIconNames(): string[] {
  // A label the matcher reads only with a subject ("roots" outside maths) is offered as its id,
  // which always resolves, so a writer in any subject never picks a name that draws nothing.
  const name = (c: (typeof ICON_CONCEPTS)[number]) => {
    const label = c.label.toLowerCase();
    return resolveIcon(label) === c.id ? label : c.id;
  };
  return [...new Set(ICON_CONCEPTS.map(name))];
}

/** The shared `layout-icon` def: a listed name, or null when no listed name fits. */
export function layoutIconDef(): J {
  return { anyOf: [{ type: "string", enum: layoutIconNames() }, { type: "null" }] };
}

const writerStageOf = (ks: Ks): WriterStage => (ks === "KS3" ? "KS3-5" : ks);

/** Where each pilot layout keeps its strings: top-level fields, and its members' fields. */
const PILOT_FIELDS = {
  "items-row": { top: ["heading", "lead"], list: "items", member: ["name", "text"] },
  "panel-list": { top: ["heading", "lead"], list: "items", member: ["name", "text"] },
  "split-compare": { top: ["heading"], list: "sides", member: ["title", "text", "quote"] },
} as const;

/** A string node (or an anyOf's string branch) with `maxLength` set; other nodes as they are. */
function capString(node: J | undefined, cap: number | undefined): J | undefined {
  if (!node || !cap) return node;
  if (node.type === "string") return { ...node, maxLength: cap };
  if (Array.isArray(node.anyOf))
    return {
      ...node,
      anyOf: node.anyOf.map((b: J) => (b.type === "string" ? { ...b, maxLength: cap } : b)),
    };
  return node;
}

/**
 * The pilot layouts' defs with each string capped at the loosest comfortable cap the menu offers
 * at this stage (`layoutFieldCaps`, the measured capacity tables). Code reads a field's room from
 * these; the writer never sees them (v4.6 is uncapped). Never hand-typed.
 */
export function capPilotDefs(defs: J, stage: WriterStage): J {
  const caps = layoutFieldCaps(stage);
  const out: J = {};
  for (const [layout, f] of Object.entries(PILOT_FIELDS) as [
    keyof typeof PILOT_FIELDS,
    (typeof PILOT_FIELDS)[keyof typeof PILOT_FIELDS],
  ][]) {
    const def = defs?.[layout];
    if (!def) continue;
    const c = caps[layout];
    const d = structuredClone(def) as J;
    for (const k of f.top) if (d.properties[k]) d.properties[k] = capString(d.properties[k], c[k]);
    const m = d.properties[f.list]?.items;
    if (m?.properties)
      for (const k of f.member)
        if (m.properties[k]) m.properties[k] = capString(m.properties[k], c[k]);
    out[layout] = d;
  }
  // The question layouts (loop 1, 17 Oct): capped too, so every hinge, practice and exit field is
  // logged against its measured cap like the list layouts' (v4.8 logged none of them).
  const q = questionFieldCaps(stage);
  for (const [layout, f] of Object.entries(q)) {
    const def = defs?.[layout];
    if (!def) continue;
    const d = structuredClone(def) as J;
    for (const [path, cap] of Object.entries(f)) {
      const [list, leaf] = path.split("[].");
      if (!leaf) d.properties[path] = capString(d.properties[path], cap);
      else {
        const m = d.properties[list as string]?.items;
        if (m?.properties?.[leaf]) m.properties[leaf] = capString(m.properties[leaf], cap);
      }
    }
    out[layout] = d;
  }
  return out;
}

/** A writer schema's slide branches: every `slides` branch, then the lesson's `close` ones. */
const slideRefs = (writer: J): J[] => {
  const all = [
    ...((writer.properties?.slides?.items?.anyOf ?? []) as J[]),
    ...((writer.properties?.close?.anyOf ?? []) as J[]),
  ];
  return all.filter((r, k) => all.findIndex((x) => x.$ref === r.$ref) === k);
};
const templatesOf = (writer: J, ref: J): string[] =>
  writer.$defs?.[String(ref.$ref).replace("#/$defs/", "")]?.properties?.template?.enum ?? [];

/** The layouts a writer schema offers: the `template` of every slide branch, close included. */
export function offeredLayouts(writer: J): string[] {
  return [...new Set(slideRefs(writer).flatMap((r) => templatesOf(writer, r)))];
}

/**
 * The repair's layouts menu on a pack (ruling 218): the "Layouts." line of the writer's own system
 * text, then each line of a layout the writer is offered, word for word as the writer read them.
 * `layoutsFor` then cuts it to the slide's layout and those it may switch to.
 */
export function packRepairMenu(system: string, offered: readonly string[]): string {
  const lines = system.split("\n");
  const head = lines.findIndex((l) => l.startsWith("Layouts. "));
  if (head < 0) throw new Error("pilot pack: no Layouts line in the system text");
  const want = new Set(offered);
  return [
    lines[head],
    ...lines.slice(head + 1).filter((l) => want.has(/^- ([a-z-]+): /.exec(l)?.[1] ?? "")),
  ].join("\n");
}

/** The repair envelope with `slide` one of `refs`, and only the defs those reach. */
function repairWith(repair: J, writer: J, refs: J[]): J {
  const out = structuredClone(repair) as J;
  const pool: J = { ...(out.$defs ?? {}), ...(writer.$defs ?? {}) };
  out.properties.slide = { anyOf: refs };
  const keep: J = {};
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as J)) {
      if (k === "$ref" && typeof v === "string") {
        const name = v.replace("#/$defs/", "");
        if (!keep[name] && pool[name]) {
          keep[name] = pool[name];
          walk(pool[name]);
        }
      } else walk(v);
    }
  };
  walk(out.properties);
  out.$defs = keep;
  return out;
}

/**
 * The repair's schema on a pack (ruling 218): the repair's own envelope (`fix`, `slide`,
 * `to_notes`) with `slide` any of `layouts` exactly as the writer's schema defines them, every fit
 * with its item counts, so a repaired slide only becomes a layout production offers. A layout the
 * writer is not offered is never added.
 */
export function packRepairSchema(repair: J, writer: J, layouts: readonly string[]): J {
  const want = new Set(layouts);
  const refs = slideRefs(writer).filter((r) => templatesOf(writer, r).some((t) => want.has(t)));
  return repairWith(repair, writer, refs);
}

/**
 * The fit repair's schema for one pilot slide: the repair's own envelope (`fix`, `slide`,
 * `to_notes`) with `slide` fixed to the layout, and only the defs that layout reaches (its pictures,
 * diagrams, icon names). Every other layout's def stays out, so the call is small.
 */
export function pilotRepairSchema(repair: J, writer: J, template: string): J {
  // A capped repair would cut its own fix, as the writer's decoder did.
  return stripStringCaps(repairWith(repair, writer, [{ $ref: `#/$defs/${template}` }]));
}

const str = { type: "string" };
const strOrNull = { anyOf: [{ type: "string" }, { type: "null" }] };
const obj = (properties: J): J => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const list = (items: J, [min, max]: readonly [number, number]): J => ({
  type: "array",
  items,
  minItems: min,
  maxItems: max,
});

/**
 * The question layouts' defs (TEACH-110 part v): one def each, item counts from the capacity
 * tables (`questionOffer`, the same numbers as their menu lines), no string caps (the templates
 * measure every field at its drawn size). Each answer sits inside its question; the hinge writes
 * its correct option first and keeps no counted key; the question of a hinge is its heading.
 */
export function questionDefs(stage: WriterStage): J {
  const o = questionOffer(stage);
  const worked = obj({ question: str, answer: str, working: strOrNull });
  return {
    hinge: obj({
      template: { type: "string", enum: ["hinge"] },
      heading: str,
      options: {
        ...list(obj({ text: str, icon: { $ref: "#/$defs/layout-icon" }, why: strOrNull }), o.hinge),
        description: "the correct option first; pupils see them shuffled",
      },
    }),
    "question-set": obj({
      template: { type: "string", enum: ["question-set"] },
      heading: str,
      items: list(obj({ question: str, answer: str }), o["question-set"]),
    }),
    practice: obj({
      template: { type: "string", enum: ["practice"] },
      heading: str,
      picture: { $ref: "#/$defs/figure" },
      items: list(worked, o.practice),
    }),
    "exit-ticket": obj({
      template: { type: "string", enum: ["exit-ticket"] },
      heading: str,
      items: list(worked, o["exit-ticket"]),
    }),
  };
}
