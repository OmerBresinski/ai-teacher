import {
  checkLesson,
  type Finding,
  isSchemaCheck,
  type Lesson,
  type Worksheet,
} from "@tj/domain/documents";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AUTOSAVE_MS } from "../model/use-autosave";

/*
 * The residual findings the editor shows (ADR 0025 §10, §12, §25): the model checks and the
 * budget stop exactly as the job stored them on `Lesson.generation.findings`, plus the schema
 * checks recomputed live by `checkLesson` — never trusted from storage, so a hand fix clears its
 * badge on the next save. `SlideBadge` on the navigator rows and `ResidualBadge` in the canvas
 * footer both read `ResidualFindingsContext`, which `LessonEditor` fills from `useResidualFindings`.
 */

/** The merge, pure: stored model findings + live schema findings, deduped by `check` + target. */
export function residualFindings(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const stored = (lesson.generation?.findings ?? []).filter((f) => !isSchemaCheck(f.check));
  const live = checkLesson(lesson, worksheet);
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const finding of [...stored, ...live]) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

const findingKey = (f: Finding) =>
  [f.check, f.target.slideId, f.target.elementId, f.target.blockId, f.target.factId].join("|");

/** Findings grouped by the slide they point at; lesson-level ones (no `slideId`) are left out. */
export function findingsBySlide(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    const id = finding.target.slideId;
    if (id === undefined) continue;
    const list = map.get(id);
    if (list) list.push(finding);
    else map.set(id, [finding]);
  }
  return map;
}

/** "3 things to check" / "1 thing to check". */
export const thingsToCheck = (n: number) => `${n} ${n === 1 ? "thing" : "things"} to check`;

export type ResidualFindings = {
  findings: Finding[];
  bySlide: Map<string, Finding[]>;
};

const EMPTY: ResidualFindings = { findings: [], bySlide: new Map() };

export const ResidualFindingsContext = createContext<ResidualFindings>(EMPTY);

/** Every residual finding; `bySlide` for the navigator dots. */
export const useResidualFindings = (): ResidualFindings => useContext(ResidualFindingsContext);

/**
 * Recompute on the autosave cadence: the first lesson seen (at mount, or when the query fills)
 * is merged synchronously; every later change to the lesson or the worksheet re-runs
 * `checkLesson` after `AUTOSAVE_MS`, never per keystroke. The timer is the one external thing
 * here, hence an effect; the merge itself is pure.
 */
export function useComputedResidualFindings(
  lesson: Lesson | undefined,
  worksheet: Worksheet | undefined,
  delay: number = AUTOSAVE_MS,
): ResidualFindings {
  const [state, setState] = useState<{ seeded: boolean; findings: Finding[] }>(() => ({
    seeded: lesson !== undefined,
    findings: lesson ? residualFindings(lesson, worksheet) : [],
  }));
  // The lesson arrived after mount (the query filled): seed once, in render, not a tick later.
  if (!state.seeded && lesson) {
    setState({ seeded: true, findings: residualFindings(lesson, worksheet) });
  }

  useEffect(() => {
    if (!lesson) return;
    const timer = window.setTimeout(
      () => setState({ seeded: true, findings: residualFindings(lesson, worksheet) }),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [lesson, worksheet, delay]);

  const { findings } = state;
  return useMemo(() => ({ findings, bySlide: findingsBySlide(findings) }), [findings]);
}
