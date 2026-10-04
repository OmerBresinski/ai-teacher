// TEACH-87 lab: v31 (line removed) vs v36 watch-out callouts on gpt-6-luna, effort low. Untracked.
import { createAi } from "@tj/ai";
import { slideSpecSchemaFor } from "@tj/slides";
import { callStructured } from "../src/call";
import { generateSlidePrompt } from "../src/prompts";
import { checkedCallout, withAssignedCallout } from "../src/specs";
import { audienceOf } from "../src/stages/shared";
import { recordingDeps, sampleBriefLesson } from "../src/testing";

const NEW = /\nThe card is labelled COMMON MISTAKE:[^\n]*/;
const v31 = {
  ...generateSlidePrompt,
  version: "generate-slide.v31",
  user: (i: never) => generateSlidePrompt.user(i).replace(NEW, ""),
};
const base = audienceOf(sampleBriefLesson());
type T = {
  name: string;
  year: string;
  title: string;
  o: string;
  k: [string, string, string];
  m: [string, string];
};
const topics: T[] = [
  {
    name: "photo-starch",
    year: "Year 9",
    title: "Photosynthesis",
    o: "Describe how plants use or store the glucose they make",
    k: [
      "Plants use glucose for growth and energy, or store it as starch",
      "Glucose from photosynthesis is used in respiration, to make cellulose and proteins, or is turned into insoluble starch for storage.",
      "Potatoes store starch in their tubers.",
    ],
    m: [
      "plants store the extra glucose they make as glucose",
      "Plants usually change extra glucose into starch before storing it.",
    ],
  },
  {
    name: "photo-chlorophyll",
    year: "Year 9",
    title: "Photosynthesis",
    o: "Explain the role of chlorophyll in photosynthesis",
    k: [
      "Chlorophyll captures light energy for photosynthesis",
      "Chlorophyll in chloroplasts absorbs light; the energy drives the reaction of carbon dioxide and water into glucose and oxygen.",
      "Leaves are green because chlorophyll reflects green light.",
    ],
    m: [
      "chlorophyll is a food that plants make and eat",
      "Chlorophyll captures light energy; photosynthesis uses it with carbon dioxide and water to make glucose.",
    ],
  },
  {
    name: "particles",
    year: "Year 7",
    title: "Particles and heating",
    o: "Explain expansion using the particle model",
    k: [
      "Heating makes particles move faster and spread out",
      "When a substance is heated its particles gain energy, move faster and take up more space, so the substance expands.",
      "Railway tracks have gaps so the rails can expand on hot days.",
    ],
    m: [
      "particles expand when a substance is heated",
      "Particles stay the same size; they move faster and spread further apart.",
    ],
  },
  {
    name: "weimar",
    year: "Year 9",
    title: "Weimar hyperinflation 1923",
    o: "Explain why hyperinflation happened in 1923",
    k: [
      "Printing money caused hyperinflation",
      "The government printed huge amounts of money to pay workers during the Ruhr occupation, so each mark bought less and prices soared.",
      "By November 1923 a loaf of bread cost 200 billion marks.",
    ],
    m: [
      "printing more money made Germany richer",
      "Printing more money made each mark worth less, so prices rose and savings became worthless.",
    ],
  },
];
const dry = process.argv.includes("--dry");
const reps = Number(process.env.REPS ?? 2);
const ai = createAi({ OPENAI_API_KEY: process.env.OPENAI_API_KEY } as never);
const deps = recordingDeps(ai as never);
const rows: string[] = [];
for (const t of topics) {
  const entry = {
    kind: "content",
    factRefs: ["k1"],
    callout: { kind: "watch-out", factRefs: ["m1"] },
  } as never;
  const misconceptions = [{ id: "m1", belief: t.m[0], correction: t.m[1], objectiveRefs: ["o1"] }];
  const input = {
    referenced: {
      objectives: [{ id: "o1", text: t.o }],
      keyIdeas: [
        {
          id: "k1",
          statement: t.k[0],
          explanation: t.k[1],
          example: t.k[2],
          objectiveRefs: ["o1"],
        },
      ],
      vocabulary: [],
      workedExamples: [],
      questions: [],
      misconceptions,
      outline: [],
      durationMin: 60,
    },
    entry,
    shape: { verb: "Explain", confidence: "Some prior knowledge" },
    position: { index: 5, total: 8 },
    neighbours: {},
    reservedStems: [],
    phase: "explain",
    audience: {
      ...base,
      yearGroup: t.year,
      subject: t.name === "weimar" ? "History" : "Science",
      readingLevel: undefined,
      ageBand: undefined,
    },
    vocabularySlots: 4,
    lessonTitle: t.title,
  } as never;
  for (const [arm, prompt] of [
    ["v31", v31],
    ["v36", generateSlidePrompt],
  ] as const) {
    if (dry) {
      console.log(`--- ${t.name} ${arm}\n${(prompt as typeof generateSlidePrompt).user(input)}`);
      continue;
    }
    for (let r = 0; r < reps; r++) {
      const call = await callStructured({
        deps: deps as never,
        stage: "generate",
        cls: "small",
        effort: "low",
        prompt: prompt as never,
        input,
        schema: withAssignedCallout(slideSpecSchemaFor("content"), {
          kind: "watch-out",
          factRefs: ["m1"],
        }) as never,
        maxOutputTokens: 2400,
      });
      const out = call.output as { callout?: { text: string } };
      const g = checkedCallout(
        call.output as never,
        { kind: "watch-out", factRefs: ["m1"] },
        misconceptions,
      );
      rows.push(
        `${t.name}\t${arm}\t${out.callout?.text}\t${g.fellBack ? "GUARD->" + (g.spec as { callout: { text: string } }).callout.text : "kept"}`,
      );
      console.log(rows.at(-1));
    }
  }
}
if (!dry) console.log(JSON.stringify(deps.budget.totals?.() ?? deps.budget));
