// exit1 (8 Oct, rootcause/d36-ks1.txt; UX rulings 141 and 148): the writer always writes a top-level
// `exit_ticket` (2-3 questions). Code places it as the lesson's last slide, inside the slide count:
// - brief.exitTicketOnSlides: ruling 148's "Before you go" slide, the questions on it (exit-ticket layout);
// - otherwise: ruling 141's closing slide sending the class to the worksheet (production closing.ts copy),
//   the questions kept as worksheet content in lesson.json's `exitTicket`.
// Both are the lesson-level check for D36 (lessongate.py reads lesson.json's `exitTicket`).

export type WriterExitTicket = { questions: string[] };
export type PlacedExitTicket = {
  questions: string[];
  onSlides: boolean;
  /** 1-based slide number of the code-placed slide. */
  slide: number;
  /** The code slide's lab template: "exit-ticket" on slides, "explain" for the worksheet pointer. */
  template: "exit-ticket" | "explain";
};

export const BEFORE_YOU_GO = "Before you go";
const questionsWord = (n: number) => `${n} ${n === 1 ? "question" : "questions"}`;

/** The writer's field, read defensively (a stream may end early); undefined when unusable. */
export function readExitTicket(v: unknown): WriterExitTicket | undefined {
  const q = (v as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(q)) return undefined;
  const questions = q.map((x) => String(x ?? "").trim()).filter(Boolean);
  return questions.length ? { questions } : undefined;
}

/**
 * The code slide (lab T template shape) and its flow entry for a writer plan of `planned` slides
 * (title and objectives included). The slide goes at number planned + 1.
 */
export function exitTicketSlide(
  et: WriterExitTicket,
  onSlides: boolean,
  planned: number,
): {
  slide: Record<string, unknown>;
  flow: { slide: number; does: string; look_at: { kind: "none"; shows: null }; teaches: number[] };
  placed: PlacedExitTicket;
} {
  const n = planned + 1;
  const slide = onSlides
    ? {
        template: "exit-ticket",
        heading: BEFORE_YOU_GO,
        questions: et.questions,
        instruction: "Answer on your own.",
      }
    : {
        template: "explain",
        heading: "Exit ticket",
        lead: "Complete it on your worksheet.",
        points: [`${questionsWord(et.questions.length)}, on your own.`],
      };
  return {
    slide,
    // Code claims no objective for the slide (meaning stays with models); D36 counts it by kind.
    flow: {
      slide: n,
      does: onSlides ? "Exit ticket (code)" : "Exit ticket on the worksheet (code)",
      look_at: { kind: "none", shows: null },
      teaches: [],
    },
    placed: {
      questions: et.questions,
      onSlides,
      slide: n,
      template: onSlides ? "exit-ticket" : "explain",
    },
  };
}
