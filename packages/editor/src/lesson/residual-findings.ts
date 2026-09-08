import {
  checkLesson,
  type Finding,
  isSchemaCheck,
  type Lesson,
  type Worksheet,
} from "@tj/domain/documents";
import { createContext, useContext, useMemo, useState } from "react";
import { type Autosave, useSaveState, useSettledDocument } from "../model/use-autosave";

/*
 * The residual findings the editor shows (ADR 0025 §10, §12, §25): the model checks and the
 * budget stop exactly as the job stored them on `Lesson.generation.findings`, plus the schema
 * checks recomputed live by `checkLesson` — never trusted from storage, so a hand fix clears its
 * badge on the next save. `SlideBadge` on the navigator rows and `ResidualBadge` in the canvas
 * footer both read `ResidualFindingsContext`, which `LessonEditor` fills from
 * `useComputedResidualFindings`.
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
 * The residual findings at the save cadence, derived in render — no effect. While the teacher is
 * typing (`unsaved`, `saving`, `failed`) the merge runs over the document the autosave debounce
 * last handed to the write (`getSettled`), so it moves every 800 ms and never per keystroke; once
 * everything is `saved` the live document is that same document — or a fresher one a Reload put
 * in the cache — so the live one is read. Between the first edit and the first debounce there is
 * no settled document yet, so the previous source stays (React's "information from previous
 * renders" pattern). `checkLesson` is cheap; the memo keys on the document identity immer
 * preserves, so an unchanged lesson is free.
 */
export function useComputedResidualFindings(
  lesson: Lesson | undefined,
  worksheet: Worksheet | undefined,
  autosave: Autosave<Lesson>,
): ResidualFindings {
  const state = useSaveState(autosave);
  const settled = useSettledDocument(autosave);
  const desired = state === "saved" ? lesson : settled;
  const [source, setSource] = useState(lesson);
  if (desired !== undefined && desired !== null && desired !== source) setSource(desired);
  const current = desired ?? source;
  return useMemo(() => {
    const findings = current ? residualFindings(current, worksheet) : [];
    return { findings, bySlide: findingsBySlide(findings) };
  }, [current, worksheet]);
}
