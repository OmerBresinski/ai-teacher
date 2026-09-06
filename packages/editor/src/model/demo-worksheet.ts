import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { docFromText, now, uid } from "./factories";
import { answerLinesForMarks, numberQuestions } from "./worksheet-factories";

/** The worksheet the library links to as a worked example. */
export const DEMO_WORKSHEET_ID = "demo-water-cycle-ws";

/**
 * A real Year 5 science sheet, not a layout test: an instruction line, three
 * short questions carrying marks, a multiple choice, a word bank feeding a gap
 * fill, and one extended answer with six ruled lines.
 */
export function demoWorksheet(): Worksheet {
  const ts = now();
  const gapA = uid();
  const gapB = uid();
  const gapC = uid();

  const question = (
    prompt: string,
    marks: number,
    answer: string,
    lines?: number,
  ): WorksheetBlock => ({
    id: uid(),
    type: "question",
    doc: docFromText(prompt),
    answerLines: lines ?? answerLinesForMarks(marks),
    marks,
    answer,
  });

  const blocks: WorksheetBlock[] = numberQuestions([
    {
      id: uid(),
      type: "instructions",
      doc: docFromText(
        "Answer all of the questions in the spaces provided. The number of lines tells you how much to write.",
      ),
    },
    question("Name the process that turns water in the sea into water vapour.", 1, "Evaporation."),
    question(
      "Explain why water vapour turns back into liquid water as it rises above the ground.",
      2,
      "The air is colder higher up, so the water vapour cools. Cooling makes it condense into tiny droplets.",
    ),
    question(
      "A puddle in the playground disappears on a sunny day, but no one has swept it away. Explain where the water has gone.",
      3,
      "The sun heats the puddle, the water evaporates and becomes water vapour, and the vapour moves into the air where we cannot see it.",
    ),
    {
      id: uid(),
      type: "multiple-choice",
      doc: docFromText("Which stage of the water cycle happens straight after condensation?"),
      options: [
        { id: uid(), text: "Evaporation", correct: false },
        { id: uid(), text: "Precipitation", correct: true },
        { id: uid(), text: "Transpiration", correct: false },
        { id: uid(), text: "Infiltration", correct: false },
      ],
    },
    {
      id: uid(),
      type: "word-bank",
      words: ["evaporates", "condenses", "precipitation", "freezes"],
    },
    {
      id: uid(),
      type: "fill-gap",
      doc: docFromText(
        `Use the word bank. The sun heats the sea and the water [[gap:${gapA}]] into the air. As the water vapour rises it cools and [[gap:${gapB}]] into tiny droplets, which gather to make clouds. When the droplets grow heavy they fall as [[gap:${gapC}]].`,
      ),
      gaps: [
        { id: gapA, answer: "evaporates" },
        { id: gapB, answer: "condenses" },
        { id: gapC, answer: "precipitation" },
      ],
    },
    question(
      "Describe the journey of one drop of water from the sea, into a cloud and back to the sea again. Use the words evaporation, condensation and precipitation in your answer.",
      6,
      "The drop evaporates from the sea in the heat of the sun and rises as water vapour. High in the sky it cools and condenses onto tiny particles to make a cloud. The droplets join together until they are heavy enough to fall as precipitation, then the water runs through rivers back into the sea.",
      6,
    ),
  ]);

  return {
    version: 1,
    id: DEMO_WORKSHEET_ID,
    title: "The water cycle: check your understanding",
    themeId: "chalk",
    createdAt: ts,
    updatedAt: ts,
    header: {
      showName: true,
      showDate: true,
      showClass: true,
      title: "The water cycle: check your understanding",
      subtitle: "I can explain how water moves between the sea, the sky and the land.",
    },
    blocks,
    includeAnswerKey: false,
    pageSize: "A4",
    subject: "Science",
    ageBand: "ks2",
    yearGroup: "Year 5",
  };
}
