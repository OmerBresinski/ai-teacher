/*
 * Lab-only: a recall pack (W7b arms M, C, S: Sol from its own knowledge, no sources, no evidence)
 * as the `Pack` the lesson arms read (`pack-arms.ts`, `lab.ts --arm grounded|packed`).
 *
 * A recall pack has no checker verdicts, so the pre-registered admission rule cannot apply: its
 * facts are checked in session, and the ids of the facts that failed are handed to the lab as a
 * drop list (`--pack-drop <file>`). The adapter removes those facts and stamps every remaining one
 * `checked: true`; without a drop list every fact is `checked: false`, so a result can never claim
 * a check that did not happen. `sectionToObjectiveFacts` copies named fields only, so the flag
 * never reaches a lesson.
 *
 * Fact ids are `secN.fK`, K the fact's flat position in the section across the fact types in
 * `FACT_TYPES` order (key ideas, misconceptions, vocabulary, worked examples, questions): the same
 * numbering `admitPack` and the checkers use, and the one `facts-<topic>.md` lists for the reader.
 */

import type { DroppedFact } from "./pack-arms";
import { RECALL_ARMS, type RecallPack, RecallPackSchema } from "./pack-author";
import { checkFactText } from "./packs/prompts";
import { FACT_TYPES, type FactType, type Pack, type PackFacts, PackSchema } from "./packs/schema";

export const factId = (section: string, flat: number): string => `${section}.f${flat}`;

export type LabPackParse = { kind: "sourced"; pack: Pack } | { kind: "recall"; pack: RecallPack };

/** A pack file by its `arm`: a recall arm parses as a recall pack, anything else as a sourced one. */
export function parseLabPack(raw: unknown): LabPackParse {
  const arm = (raw as { arm?: unknown } | null)?.arm;
  if (typeof arm === "string" && (RECALL_ARMS as readonly string[]).includes(arm))
    return { kind: "recall", pack: RecallPackSchema.parse(raw) };
  return { kind: "sourced", pack: PackSchema.parse(raw) };
}

/** Every fact of a recall pack with its id, in id order: what the in-session checker reads. */
export function listRecallFacts(
  pack: Pick<RecallPack, "sections">,
): { id: string; section: string; type: FactType; index: number; text: string }[] {
  const out: { id: string; section: string; type: FactType; index: number; text: string }[] = [];
  for (const section of pack.sections) {
    let flat = 0;
    for (const type of FACT_TYPES)
      (section.facts[type] as object[]).forEach((fact, index) => {
        out.push({
          id: factId(section.id, flat++),
          section: section.id,
          type,
          index,
          text: checkFactText(type, fact),
        });
      });
  }
  return out;
}

/** A drop list: fact ids separated by newlines, spaces or commas; `#` starts a comment. */
export function parseDropList(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const body = line.replace(/#.*$/, "").trim();
    if (!body) continue;
    for (const token of body.split(/[\s,]+/).filter(Boolean)) {
      if (!/^sec\d+\.f\d+$/.test(token))
        throw new Error(`pack-drop: "${token}" is not a fact id (secN.fK)`);
      ids.add(token);
    }
  }
  return ids;
}

export interface AdaptedRecallPack {
  pack: Pack;
  /** The facts the drop list removed, in `DroppedFact` shape so result.json records them alike. */
  dropped: DroppedFact[];
  /** Facts left in the pack. */
  facts: number;
  /** True when a drop list was given: the pack's facts were checked in session. */
  checked: boolean;
}

/**
 * The recall pack as a `Pack`, minus the facts in `drop`. Every id in `drop` must name a fact of
 * this pack: a stale or mistyped id throws rather than silently dropping nothing.
 */
export function adaptRecallPack(recall: RecallPack, drop?: ReadonlySet<string>): AdaptedRecallPack {
  const checked = drop !== undefined;
  const known = new Set(listRecallFacts(recall).map((f) => f.id));
  const unknown = [...(drop ?? [])].filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`pack-drop: not in pack ${recall.id}: ${unknown.join(", ")}`);
  const dropped: DroppedFact[] = [];
  let kept = 0;
  const sections: Pack["sections"] = recall.sections.map((section) => {
    let flat = 0;
    const facts = {} as PackFacts;
    for (const type of FACT_TYPES) {
      const list: object[] = [];
      (section.facts[type] as object[]).forEach((fact, index) => {
        const id = factId(section.id, flat);
        if (drop?.has(id)) {
          dropped.push({
            section: section.id,
            type,
            index,
            fact: flat,
            verdicts: {},
            failed: ["session:dropped"],
          });
        } else {
          list.push({ ...fact, checked });
          kept++;
        }
        flat++;
      });
      (facts as Record<FactType, object[]>)[type] = list;
    }
    return { id: section.id, outcome: section.outcome, sentenceIds: [], facts };
  });
  const pack: Pack = {
    id: recall.id,
    topic: recall.topic,
    subject: recall.subject,
    yearGroup: recall.yearGroup,
    arm: recall.arm,
    writtenAt: recall.writtenAt,
    provenance: { writer: recall.provenance.writer, writerPrompt: recall.provenance.writerPrompt },
    sources: [],
    sections,
  };
  return { pack, dropped, facts: kept, checked };
}
