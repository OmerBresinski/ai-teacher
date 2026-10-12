import { describe, expect, test } from "bun:test";
import { type Lesson, parseLesson } from "@tj/domain/documents";
import { FICTION_IN_PERIOD_IS_HISTORICAL, isHistoricalLesson, periodFields } from "./period";
import { labAi, romansLesson } from "./planner/testing";
import { checkedWriterObjectives } from "./stages/objectives";
import { type SetAsk, setIsGenerated } from "./stages/picture-set";
import { writerBrief } from "./stages/write";
import { initialState, recordingDeps, sampleBriefLesson } from "./testing";
import { fromWriterActivity } from "./writer/activities";
import { writerRoute } from "./writer/ai-services";

/*
 * Ruling 163 (B1): the history guard keys on the period the input check names, so it holds when
 * the teacher leaves the intake's optional subject blank. The subject test stays as a fallback.
 */

const panels: SetAsk[] = [
  { key: "a", index: 1, shows: "a body wrapped in linen", mustSee: [] },
  { key: "b", index: 1, shows: "a body placed in a coffin", mustSee: [] },
];

/** A brief-only lesson as intake stores it: no `subject` field at all. */
function noSubject(extra: Partial<Lesson> = {}): Lesson {
  const { subject: _dropped, ...lesson } = sampleBriefLesson();
  return { ...lesson, ...extra } as Lesson;
}

/** A writer lesson whose input check answers `check` (the objectives come from the lab fixture). */
async function planned(
  check: Record<string, unknown>,
  from?: Lesson,
  options: { pinObjectives?: boolean } = {},
) {
  const ai = labAi({
    route: writerRoute,
    checkInput: { findings: [], ...check },
    extra: (call) =>
      call.context?.promptVersion?.endsWith("/objectives")
        ? JSON.stringify({ objectives: ["Describe how the Egyptians made a mummy."] })
        : undefined,
  });
  const deps = recordingDeps(ai);
  const { subject: _dropped, ...lesson } = romansLesson();
  const state = await checkedWriterObjectives(
    { ...initialState(from ?? (lesson as Lesson)), ...options },
    deps,
  );
  return { state, stored: deps.persisted.map((p) => p.lesson) };
}

describe("isHistoricalLesson (ruling 163, B1)", () => {
  test("a History brief with no subject field never generates set panels", async () => {
    const { state, stored } = await planned({
      historical_period: "Ancient Egypt",
      fiction_in_period: false,
    });
    expect(state.lesson.subject).toBeUndefined();
    // Stored once, at `planned`, on the lesson the later steps read.
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ historicalPeriod: "Ancient Egypt", fictionInPeriod: false });
    expect(state.lesson.historicalPeriod).toBe("Ancient Egypt");
    expect(isHistoricalLesson(state.lesson)).toBe(true);
    expect(setIsGenerated(panels, state.lesson)).toBe(false);
    // The writer's brief carries it to the activity cards: a real picture or its word.
    const brief = writerBrief(state.lesson);
    const cards = fromWriterActivity(
      {
        template: "sequence",
        cards: [1, 2, 3, 4].map((k) => ({ label: `c${k}`, picture: "a jar" })),
      },
      "KS2",
      brief,
    ).slide.cards as { picture: { subject: string } }[];
    expect(cards.map((c) => c.picture.subject)).toEqual(Array(4).fill("named"));
  });

  test("a Pompeii geography brief counts as historical", () => {
    const pompeii = noSubject({
      subject: "Geography",
      ...periodFields({ historical_period: "Roman Pompeii, AD 79", fiction_in_period: false }),
    });
    expect(isHistoricalLesson(pompeii)).toBe(true);
    expect(setIsGenerated(panels, pompeii)).toBe(false);
  });

  test("fiction set in a period follows FICTION_IN_PERIOD_IS_HISTORICAL", () => {
    const carol = noSubject({
      subject: "English",
      historicalPeriod: "Victorian London",
      fictionInPeriod: true,
    });
    expect(isHistoricalLesson(carol)).toBe(FICTION_IN_PERIOD_IS_HISTORICAL);
    expect(setIsGenerated(panels, carol)).toBe(!FICTION_IN_PERIOD_IS_HISTORICAL);
    // A History subject stays historical whatever the fiction flag says.
    expect(isHistoricalLesson({ ...carol, subject: "History" })).toBe(true);
  });

  test("a present-day science brief is unchanged", async () => {
    const { state, stored } = await planned({ historical_period: null, fiction_in_period: false });
    expect(stored[0]).not.toHaveProperty("historicalPeriod");
    expect(stored[0]).not.toHaveProperty("fictionInPeriod");
    expect(isHistoricalLesson(state.lesson)).toBe(false);
    const science = { ...state.lesson, subject: "Science" };
    expect(isHistoricalLesson(science)).toBe(false);
    expect(setIsGenerated(panels, science)).toBe(true);
    expect(writerBrief(science)).not.toHaveProperty("historicalPeriod");
  });

  test("old stored lessons without the fields still work", () => {
    const { historicalPeriod: _p, fictionInPeriod: _f, ...old } = sampleBriefLesson();
    const history = parseLesson(JSON.parse(JSON.stringify({ ...old, subject: "History" })));
    const science = parseLesson(JSON.parse(JSON.stringify({ ...old, subject: "Science" })));
    expect(history.historicalPeriod).toBeUndefined();
    expect(history.fictionInPeriod).toBeUndefined();
    expect(isHistoricalLesson(history)).toBe(true);
    expect(isHistoricalLesson(science)).toBe(false);
    expect(setIsGenerated(panels, history)).toBe(false);
    expect(setIsGenerated(panels, science)).toBe(true);
    // A check answer from before v5 (no period fields) stores nothing.
    expect(periodFields({})).toEqual({});
    // Stored fields round-trip through the document schema.
    const stored = parseLesson(
      JSON.parse(
        JSON.stringify({ ...old, historicalPeriod: "Tudor England", fictionInPeriod: false }),
      ),
    );
    expect(stored).toMatchObject({ historicalPeriod: "Tudor England", fictionInPeriod: false });
  });

  test("a re-plan from Egypt to fractions clears the stored period", async () => {
    const egypt = (await planned({ historical_period: "Ancient Egypt", fiction_in_period: false }))
      .state.lesson;
    expect(egypt.historicalPeriod).toBe("Ancient Egypt");
    const fractions = {
      ...egypt,
      title: "Adding fractions",
      brief: {
        ...egypt.brief,
        topic: "Adding fractions with the same denominator",
        durationMin: 60,
      },
    } as Lesson;
    const { state, stored } = await planned(
      { historical_period: null, fiction_in_period: false },
      fractions,
    );
    expect(stored[0]).not.toHaveProperty("historicalPeriod");
    expect(stored[0]).not.toHaveProperty("fictionInPeriod");
    expect(isHistoricalLesson(state.lesson)).toBe(false);
    expect(setIsGenerated(panels, state.lesson)).toBe(true);
  });

  test("a pinned re-plan takes the latest check's period, null included", async () => {
    const egypt = (await planned({ historical_period: "Ancient Egypt", fiction_in_period: false }))
      .state.lesson;
    expect(egypt.facts?.objectives?.length).toBeGreaterThan(0);
    const cleared = await planned({ historical_period: null, fiction_in_period: false }, egypt, {
      pinObjectives: true,
    });
    expect(cleared.stored).toHaveLength(1);
    expect(cleared.stored[0]).not.toHaveProperty("historicalPeriod");
    expect(isHistoricalLesson(cleared.state.lesson)).toBe(false);
    const fiction = await planned(
      { historical_period: "Victorian London", fiction_in_period: true },
      egypt,
      { pinObjectives: true },
    );
    expect(fiction.stored[0]).toMatchObject({
      historicalPeriod: "Victorian London",
      fictionInPeriod: true,
    });
  });
});
