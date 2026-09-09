import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { docFromText, now, uid } from "./factories";
import { answerLinesForMarks, newWorksheet, numberQuestions } from "./worksheet-factories";

/** The worksheet the library links to as a worked example: "Fractions practice". */
export const DEMO_WORKSHEET_ID = "demo-fractions-practice-ws";

/**
 * The four seeded worksheets (TEACH-186), one per job: Practise, Homework, Check and Starter.
 * Each is a real sheet a teacher could hand out, with an objective in the header, success criteria
 * in the self-assessment strip at the foot, answers on every question so the answer key derives,
 * and content sized to print on one
 * or two pages of A4 or Letter without a heading stranded at the foot of a page (headings sit
 * early in each sheet; `paginate` has no orphan rule).
 */

type Meta = Pick<Worksheet, "subject" | "yearGroup" | "ageBand"> & {
  title: string;
  themeId: string;
  objective: string;
  criteria: string[];
  /** UX ruling 60: the sheets that count marks; the others leave it unset. */
  showMarks?: boolean;
};

function sheet(meta: Meta, blocks: WorksheetBlock[]): Worksheet {
  const ts = now();
  const base = newWorksheet(meta.title, meta.themeId);
  return {
    ...base,
    createdAt: ts,
    updatedAt: ts,
    header: {
      showName: true,
      showDate: true,
      showClass: true,
      title: meta.title,
      subtitle: meta.objective,
      criteria: meta.criteria,
    },
    blocks: numberQuestions(blocks),
    // The criteria print in the self-assessment strip at the foot (TEACH-196), so the strip is on.
    selfAssessment: true,
    subject: meta.subject,
    yearGroup: meta.yearGroup,
    ageBand: meta.ageBand,
    ...(meta.showMarks ? { showMarks: true } : {}),
  };
}

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

const instructions = (text: string): WorksheetBlock => ({
  id: uid(),
  type: "instructions",
  doc: docFromText(text),
});

const paragraph = (text: string): WorksheetBlock => ({
  id: uid(),
  type: "paragraph",
  doc: docFromText(text),
});

const heading = (text: string): WorksheetBlock => ({
  id: uid(),
  type: "heading",
  doc: docFromText(text),
  level: 2,
});

/** Practise: Year 4 Maths, six numbered questions with rising marks on fractions of amounts. */
export function fractionsPracticeWorksheet(): Worksheet {
  return sheet(
    {
      title: "Fractions practice",
      themeId: "playground",
      showMarks: true,
      subject: "Maths",
      yearGroup: "Year 4",
      ageBand: "ks2",
      objective:
        "I can find a fraction of an amount by dividing by the denominator and multiplying by the numerator.",
      criteria: [
        "I divide by the bottom number to find one part",
        "I multiply one part by the top number",
        "I show my working for every question",
        "I check that my answer makes sense",
      ],
    },
    [
      instructions(
        "Practise. Answer every question in the space given and show your working. The number of lines tells you how much to write.",
      ),
      heading("Worked example"),
      paragraph(
        "To find 3/4 of 20, first divide by the bottom number: 20 ÷ 4 = 5, so one quarter of 20 is 5. Then multiply by the top number: 5 × 3 = 15. So 3/4 of 20 is 15.",
      ),
      question("What is 1/2 of 18?", 1, "9"),
      question("What is 1/4 of 24?", 1, "6"),
      question("Find 3/4 of 24.", 2, "24 ÷ 4 = 6, then 6 × 3 = 18."),
      question("Find 2/3 of 27.", 2, "27 ÷ 3 = 9, then 9 × 2 = 18."),
      question(
        "A packet holds 30 sweets. Amira eats 2/5 of them. How many sweets does she eat, and how many are left?",
        3,
        "30 ÷ 5 = 6, then 6 × 2 = 12 sweets eaten. 30 − 12 = 18 sweets left.",
      ),
      question(
        "Sam says 3/8 of 40 is 5, because 40 ÷ 8 = 5. Explain what Sam has forgotten and give the correct answer.",
        3,
        "Sam has found one eighth but forgotten to multiply by the top number. 5 × 3 = 15, so 3/8 of 40 is 15.",
      ),
    ],
  );
}

/** The source paragraph, 150 to 180 words, on a Roman road. */
export const ROMAN_SOURCE_TEXT =
  "In AD 43 the Roman army landed in Britain. Soldiers needed to move quickly between their forts, so the army built roads. One of the longest was Watling Street, which ran from the coast of Kent, through London, to the fort at Wroxeter in Shropshire. Surveyors used a tool called a groma to line up posts so that each stretch of road was as straight as possible. Then soldiers and local workers dug two ditches and piled the earth in the middle to make a raised bank called an agger. On top they laid large stones, then smaller stones and gravel, packed down hard. The surface curved so that rain ran off into the ditches. Every fifteen miles or so there was a posting station where riders could change horses. A soldier on foot could march about twenty miles a day on a road like this. Traders soon used the roads too, carrying pottery, wine and metal to the new towns.";

/** Homework: Year 4 History, a written source, four questions with marks and an answer box. */
export function romanSourceWorksheet(): Worksheet {
  return sheet(
    {
      title: "Roman source investigation",
      themeId: "beacon",
      showMarks: true,
      subject: "History",
      yearGroup: "Year 4",
      ageBand: "ks2",
      objective:
        "I can use a written source to find out how the Romans built and used their roads.",
      criteria: [
        "I find facts in the source",
        "I explain what a fact tells us",
        "I say what the source cannot tell us",
      ],
    },
    [
      instructions(
        "Homework. Read the source carefully, then answer the questions. Use words from the source in your answers.",
      ),
      heading("Source A: a Roman road across Britain"),
      paragraph(ROMAN_SOURCE_TEXT),
      question(
        "Why did the Roman army build roads in Britain?",
        1,
        "So that soldiers could move quickly between their forts.",
      ),
      question(
        "Describe two things the builders did to stop rain damaging the road.",
        2,
        "They raised the road on a bank called an agger, and they curved the surface so rain ran off into the ditches.",
      ),
      question(
        "Explain why a groma was important to the road builders.",
        2,
        "It lined up posts so the road ran as straight as possible, which made journeys shorter and faster.",
      ),
      question(
        "The source says traders used the roads too. What does this tell us about how the roads changed life in Britain, and what can the source not tell us?",
        3,
        "Goods such as pottery, wine and metal could reach the new towns, so trade grew. The source cannot tell us what ordinary Britons thought of the roads or who paid for them.",
      ),
      {
        id: uid(),
        type: "answer-box",
        heightPt: 110,
        label: "Draw the layers of the road. Label the agger, the stones and the ditches.",
      },
    ],
  );
}

/**
 * A flowering plant drawn as an SVG, so the sheet carries its own picture with no upload and no
 * licence: roots, stem, two leaves and a flower, with the letters A to D pointing at the parts a
 * pupil labels on the lines below.
 */
const PLANT_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 260" font-family="Arial, sans-serif" font-size="16" font-weight="700">',
  '<rect width="240" height="260" fill="#fff"/>',
  '<line x1="0" y1="190" x2="240" y2="190" stroke="#8a6d3b" stroke-width="2"/>',
  '<g stroke="#8a6d3b" stroke-width="3" fill="none" stroke-linecap="round">',
  '<path d="M120 190 L104 224 L90 246"/><path d="M120 190 L136 226 L150 244"/><path d="M120 190 L120 240"/>',
  '<path d="M112 206 L96 214"/><path d="M128 208 L144 216"/>',
  "</g>",
  '<path d="M120 190 L120 60" stroke="#3c8a3c" stroke-width="6" stroke-linecap="round"/>',
  '<path d="M120 150 C90 150 70 130 66 108 C92 106 116 120 120 150 Z" fill="#5fb85f" stroke="#3c8a3c" stroke-width="2"/>',
  '<path d="M120 120 C150 120 170 100 174 78 C148 76 124 90 120 120 Z" fill="#5fb85f" stroke="#3c8a3c" stroke-width="2"/>',
  '<g fill="#f2a0c0" stroke="#c9648e" stroke-width="2">',
  '<ellipse cx="120" cy="30" rx="10" ry="18"/><ellipse cx="120" cy="82" rx="10" ry="18"/>',
  '<ellipse cx="94" cy="56" rx="18" ry="10"/><ellipse cx="146" cy="56" rx="18" ry="10"/>',
  '<ellipse cx="102" cy="38" rx="14" ry="14"/><ellipse cx="138" cy="38" rx="14" ry="14"/>',
  '<ellipse cx="102" cy="74" rx="14" ry="14"/><ellipse cx="138" cy="74" rx="14" ry="14"/>',
  "</g>",
  '<circle cx="120" cy="56" r="13" fill="#f5c542" stroke="#c9963a" stroke-width="2"/>',
  '<g stroke="#333" stroke-width="1.5" fill="none">',
  '<path d="M196 40 L162 50"/><path d="M196 150 L150 180"/><path d="M34 110 L64 108"/><path d="M40 230 L84 236"/>',
  "</g>",
  '<g fill="#333"><text x="204" y="46">A</text><text x="204" y="156">B</text><text x="14" y="116">C</text><text x="18" y="236">D</text></g>',
  "</svg>",
].join("");

export const PLANT_IMAGE_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(PLANT_SVG)}`;

/** Check: Year 3 Science, a labelled drawing, a word bank, label lines and four short questions. */
export function plantLabelsWorksheet(): Worksheet {
  return sheet(
    {
      title: "Label a flowering plant",
      themeId: "chalk",
      subject: "Science",
      yearGroup: "Year 3",
      ageBand: "ks2",
      objective: "I can name the parts of a flowering plant and say what each part does.",
      criteria: ["I label the roots, stem, leaves and flower", "I say what each part is for"],
    },
    [
      instructions(
        "Check. Look at the drawing. Write the name of each part on the lines, A to D, using the word bank. Then answer the questions in full sentences.",
      ),
      {
        id: uid(),
        type: "image",
        src: PLANT_IMAGE_SRC,
        alt: "A flowering plant with its roots, stem, leaves and flower. The letters A to D point at the parts to label.",
        widthPct: 40,
        caption: "Figure 1: a flowering plant",
      },
      { id: uid(), type: "word-bank", words: ["roots", "stem", "leaves", "flower"] },
      paragraph("Labels, one per line: A, B, C, D."),
      { id: uid(), type: "lines", count: 4 },
      question("Which part of the plant takes in water from the soil?", 1, "The roots."),
      question(
        "What does the stem do for the plant?",
        1,
        "It holds the plant up and carries water from the roots to the leaves and the flower.",
      ),
      question(
        "Why do the leaves need sunlight?",
        1,
        "The leaves use sunlight to make food for the plant.",
      ),
      question(
        "What is the job of the flower?",
        1,
        "The flower makes seeds so that new plants can grow. Its petals attract insects.",
      ),
    ],
  );
}

/** Twelve river words for the grid; every one fits a 12-cell side. */
export const RIVER_WORDS = [
  "source",
  "mouth",
  "meander",
  "tributary",
  "estuary",
  "erosion",
  "deposition",
  "floodplain",
  "channel",
  "delta",
  "confluence",
  "waterfall",
];

/** The grid seed: one at which every word in `RIVER_WORDS` places (checked by the test). */
export const RIVER_WORD_SEARCH_SEED = 1;

/** Starter: Year 5 Geography, a 12 by 12 word search with its bank and six terms to match. */
export function riverVocabularyWorksheet(): Worksheet {
  return sheet(
    {
      title: "River vocabulary",
      themeId: "reading-room",
      subject: "Geography",
      yearGroup: "Year 5",
      ageBand: "ks2",
      objective: "I can use the key words for the parts of a river.",
      criteria: ["I find all twelve words in the grid", "I match each term to its meaning"],
    },
    [
      instructions(
        "Starter. Find the twelve river words in the grid, then draw a line from each term to its definition. You have five minutes.",
      ),
      {
        id: uid(),
        type: "word-search",
        words: RIVER_WORDS,
        size: 12,
        directions: "across-down",
        seed: RIVER_WORD_SEARCH_SEED,
        showWordBank: true,
      },
      {
        id: uid(),
        type: "matching",
        pairs: [
          { id: uid(), left: "source", right: "Where a river begins, often high in the hills" },
          {
            id: uid(),
            left: "mouth",
            right: "Where a river ends and flows into the sea or a lake",
          },
          { id: uid(), left: "tributary", right: "A smaller river that joins a larger one" },
          { id: uid(), left: "meander", right: "A wide bend in a river" },
          {
            id: uid(),
            left: "erosion",
            right: "The wearing away of the bank and bed by moving water",
          },
          {
            id: uid(),
            left: "floodplain",
            right: "The flat land beside a river that floods when the river is full",
          },
        ],
      },
    ],
  );
}

/** The worksheet the library opens as a worked example. */
export function demoWorksheet(): Worksheet {
  const body = fractionsPracticeWorksheet();
  body.id = DEMO_WORKSHEET_ID;
  return body;
}
