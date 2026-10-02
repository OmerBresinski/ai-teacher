import type { FakeCall } from "@tj/ai/testing";
import type { BlockSpec } from "@tj/slides";
import type { LessonSheetOutput } from "./lesson-specs";

/*
 * The fake AI's "Follows the lesson" writer (TEACH-86), for tests, the worker's scripted fake
 * (`AI_FAKE_SCRIPT=pipeline`) and the PR renders: no model call. It reads the brief the real call
 * gets (`generateWorksheetLessonPrompt.user`) back out of the prompt text and writes a
 * deterministic sheet from each cycle's own slide lines — a word bank and gap-fill for primary,
 * a short answer for secondary, an "Explain" stretch with model points, marks at KS4 and post-16,
 * and the exit ticket when asked. It stands in for the model's shape, not its quality.
 */

type ParsedCycle = { index: number; title: string; objectives: string[]; lines: string[] };
type ParsedBrief = {
  ageBand: string;
  examStyle: boolean;
  exitTicket: boolean;
  objectives: { id: string; text: string }[];
  cycles: ParsedCycle[];
};

export function parseLessonSheetPrompt(text: string): ParsedBrief {
  const brief: ParsedBrief = {
    ageBand: /key stage: ([a-z0-9]+)/.exec(text)?.[1] ?? "ks3",
    examStyle: /Exam-style marked items: allowed/.test(text),
    exitTicket: /Exit ticket: yes/.test(text),
    objectives: [],
    cycles: [],
  };
  let section: "objectives" | "cycles" | "" = "";
  for (const raw of text.split("\n")) {
    if (raw.startsWith("Objectives:")) section = "objectives";
    else if (raw.startsWith("Learning cycles")) section = "cycles";
    else if (raw.startsWith("Exit ticket:") || raw.startsWith("Block shapes:")) section = "";
    else if (section === "objectives") {
      const m = /^ {2}(\S+): (.+)$/.exec(raw);
      if (m?.[1] && m[2]) brief.objectives.push({ id: m[1], text: m[2] });
      else if (raw.trim() !== "") section = "";
    } else if (section === "cycles") {
      const head = /^Cycle (\d+): (.*) \(objectives: (.*)\)$/.exec(raw);
      if (head) {
        brief.cycles.push({
          index: Number(head[1]),
          title: head[2] ?? "",
          objectives: (head[3] ?? "").split(", ").filter((o) => o !== "none named"),
          lines: [],
        });
      } else if (raw.startsWith("    ")) {
        brief.cycles.at(-1)?.lines.push(raw.trim());
      }
    }
  }
  return brief;
}

const PRIMARY = new Set(["eyfs", "ks1", "ks2"]);
const sentence = (line: string) => /[a-z].*\s.*\s/i.test(line) && !line.endsWith("?");
const longestWord = (line: string) =>
  [...line.matchAll(/[A-Za-z]{5,}/g)].map((m) => m[0]).sort((a, b) => b.length - a.length)[0];
const clean = (line: string) =>
  line.replace(/^(Correct|Answer|Answers|Model answer):\s*/i, "").replace(/\s+/g, " ");

function cycleTask(cycle: ParsedCycle, brief: ParsedBrief): LessonSheetOutput["tasks"][number] {
  const refs = cycle.objectives;
  const facts = cycle.lines.map(clean).filter(sentence).slice(0, 3);
  const gapped = facts
    .map((line) => ({ line, word: longestWord(line) }))
    .filter((f): f is { line: string; word: string } => f.word !== undefined);
  const supported: BlockSpec[] = [];
  const primary = PRIMARY.has(brief.ageBand);
  if (gapped.length > 0) {
    const words = Array.from(new Set(gapped.map((g) => g.word.toLowerCase())));
    for (const extra of ["change", "because", "different"]) {
      if (words.length >= 3) break;
      if (!words.includes(extra)) words.push(extra);
    }
    if (primary) supported.push({ type: "word-bank", words, factRefs: refs });
    for (const { line, word } of gapped.slice(0, primary ? 2 : 3)) {
      supported.push({
        type: "fill-gap",
        sentence: line.replace(word, "___"),
        answers: [word.toLowerCase() === word ? word : word.toLowerCase()],
        factRefs: refs,
      });
    }
  }
  if (supported.length === 0) {
    supported.push({
      type: "question",
      text: `Write one thing you learned about ${cycle.title.toLowerCase()}.`,
      answer: facts[0] ?? cycle.title,
      answerLines: 2,
      factRefs: refs,
    });
  }
  const points =
    facts.length >= 2
      ? facts.slice(0, 3)
      : [...facts, cycle.title, "Uses the key words from the lesson."].slice(0, 2);
  const marks = brief.examStyle ? 4 : undefined;
  const stretch: BlockSpec[] = [
    {
      type: "question",
      text: primary
        ? `Tell a partner, then write: why is ${cycle.title.toLowerCase()} true?`
        : `Explain ${cycle.title.toLowerCase()}. Use the lesson's key words.`,
      answer: points.join("\n"),
      answerLines: primary ? 3 : 4,
      ...(marks !== undefined ? { marks } : {}),
      factRefs: refs,
    },
  ];
  return {
    cycle: cycle.index,
    title: cycle.title,
    instruction: primary
      ? "Use the words in the box to fill the gaps. Then answer the last question."
      : "Fill the gaps, then answer the question in full sentences.",
    supported,
    stretch,
  };
}

export function fakeLessonSheet(promptText: string): LessonSheetOutput {
  const brief = parseLessonSheetPrompt(promptText);
  const exit: BlockSpec[] | null = brief.exitTicket
    ? brief.objectives.slice(0, 3).map((o) => ({
        type: "question" as const,
        text: `In your own words, how would you show this: ${o.text.replace(/\.$/, "").toLowerCase()}?`,
        answer: o.text,
        answerLines: 2,
        factRefs: [o.id],
      }))
    : null;
  return { tasks: brief.cycles.map((c) => cycleTask(c, brief)), exitTicket: exit };
}

/** Marks a fake-AI script entry as the lesson-sheet writer, so `routed` hands it that call. */
export const LESSON_SHEET_ENTRY = Symbol("lesson-sheet");

/** A script entry that answers the lesson-sheet call from its own prompt text. */
export function lessonSheetEntry(): ((call: FakeCall) => string) & { [LESSON_SHEET_ENTRY]: true } {
  const entry = (call: FakeCall) => JSON.stringify(fakeLessonSheet(call.promptText));
  return Object.assign(entry, { [LESSON_SHEET_ENTRY]: true as const });
}
