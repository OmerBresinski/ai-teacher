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

/**
 * An applied Verify correction (TEACH-232): the fact was already fixed and the artefacts written
 * from the fixed facts, so there is nothing for the teacher to check. It stays on the document for
 * the eval and the log. The failed-call finding has no `factId` and is kept — that one is
 * actionable.
 */
const isAppliedCorrection = (f: Finding) =>
  f.check === "fact-verify" && f.target.factId !== undefined;

/** The merge, pure: stored model findings + live schema findings, deduped by `check` + target. */
export function residualFindings(lesson: Lesson, worksheet?: Worksheet): Finding[] {
  const stored = (lesson.generation?.findings ?? []).filter(
    (f) => !isSchemaCheck(f.check) && !isAppliedCorrection(f),
  );
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

/**
 * The slide a finding belongs on: its own `slideId`, or — for a lesson-level finding about an
 * objective (`objective-taught`, `objective-coverage`) — the objectives slide, where that
 * objective's line is (ruling 96). Anything else lesson-level has no slide.
 */
export function findingSlideId(finding: Finding, lesson: Lesson | undefined): string | undefined {
  if (finding.target.slideId !== undefined) return finding.target.slideId;
  const factId = finding.target.factId;
  if (!lesson || factId === undefined) return undefined;
  if (!lesson.facts?.objectives.some((o) => o.id === factId)) return undefined;
  return lesson.slides.find((s) => s.kind === "objectives")?.id;
}

/**
 * Findings grouped by the slide they belong on (`findingSlideId`); lesson-level ones with no slide
 * are left out.
 */
export function findingsBySlide(findings: Finding[], lesson?: Lesson): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const finding of findings) {
    const id = findingSlideId(finding, lesson);
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
    return { findings, bySlide: findingsBySlide(findings, current) };
  }, [current, worksheet]);
}
