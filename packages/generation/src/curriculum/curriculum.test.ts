import { afterEach, describe, expect, test } from "bun:test";
import { writerObjectivesUser } from "../stages/objectives";
import { sampleBriefLesson } from "../testing";
import { writerBundle } from "../writer/bundle";
import { ENGLAND, INDIA, setLocale } from "../writer/locale";
import {
  CURRICULUM,
  CURRICULUM_FILES,
  CurriculumFileSchema,
  curriculumBlock,
  curriculumFor,
  curriculumSubject,
  curriculumYear,
} from "./index";

const Y6_ANIMALS = [
  "identify and name the main parts of the human circulatory system, and describe the functions of the heart, blood vessels and blood",
  "recognise the impact of diet, exercise, drugs and lifestyle on the way their bodies function",
  "describe the ways in which nutrients and water are transported within animals, including humans",
];

describe("curriculum data", () => {
  test("every file and row validates against the schema", () => {
    for (const [slug, file] of Object.entries(CURRICULUM_FILES)) {
      const parsed = CurriculumFileSchema.safeParse(file);
      if (!parsed.success) throw new Error(`${slug}: ${parsed.error.message}`);
      expect(parsed.data._provenance.sourceUrl).toContain(`-${slug.split("-")[0]}`);
      for (const s of parsed.data.statements) {
        expect(s.years[0]).toBeLessThanOrEqual(s.years[1]);
        expect(s.headings.at(-1)).toBe(s.domain);
        expect(s.text).toBe(s.text.trim());
      }
    }
  });

  test("statement ids are unique and every parentId resolves", () => {
    const ids = new Set(CURRICULUM.map((s) => s.id));
    expect(ids.size).toBe(CURRICULUM.length);
    for (const s of CURRICULUM) if (s.parentId) expect(ids.has(s.parentId)).toBe(true);
  });

  test("counts per subject and key stage match the build", () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const s of CURRICULUM) {
      const bySubject = counts[s.subject] ?? {};
      bySubject[s.keyStage] = (bySubject[s.keyStage] ?? 0) + 1;
      counts[s.subject] = bySubject;
    }
    expect(counts).toEqual({
      "art and design": { KS1: 4, KS2: 3, KS3: 5 },
      citizenship: { KS3: 6, KS4: 9 },
      computing: { KS1: 6, KS2: 7, KS3: 9, KS4: 3 },
      "design and technology": { KS1: 10, KS2: 14, KS3: 19 },
      English: { "KS1-2": 12, KS1: 119, KS2: 119, KS3: 37, KS4: 38 },
      geography: { KS1: 11, KS2: 10, KS3: 10 },
      history: { KS1: 4, KS2: 9, KS3: 7 },
      languages: { KS2: 12, KS3: 12 },
      mathematics: { KS1: 70, KS2: 179, KS3: 93, KS4: 78 },
      music: { KS1: 4, KS2: 6, KS3: 6 },
      "physical education": { KS1: 3, KS2: 9, KS3: 6, KS4: 5 },
      science: { KS1: 29, KS2: 85, KS3: 155, KS4: 157 },
    });
    expect(CURRICULUM.length).toBe(1380);
  });

  test("Year 6 science Animals, including humans holds the statutory statements verbatim", () => {
    const rows = CURRICULUM.filter(
      (s) =>
        s.subject === "science" &&
        s.years[0] === 6 &&
        /^Animals,? including humans$/.test(s.domain),
    );
    expect(rows.map((s) => s.text)).toEqual(Y6_ANIMALS);
    expect(rows[1]?.id).toBe("england.science.y6.animals-including-humans.2");
  });

  test("non-statutory notes and guidance are not stored", () => {
    // From the Year 6 box "Notes and guidance (non-statutory)".
    const note = "Pupils should learn how to keep their bodies healthy";
    expect(CURRICULUM.some((s) => s.text.includes(note))).toBe(false);
    expect(CURRICULUM.some((s) => /non-statutory/i.test(s.headings.join(" ")))).toBe(false);
  });
});

describe("curriculumFor", () => {
  test("Year 6 + the heart and circulatory system puts Animals including humans first", () => {
    const r = curriculumFor({
      country: "england",
      subject: "Science",
      yearGroup: "Year 6",
      topic: "The heart and circulatory system",
    });
    expect(r.subject).toBe("science");
    expect(r.year).toBe(6);
    expect(r.matchedDomains[0]).toBe("Animals including humans");
    expect(r.statements.slice(0, 3).map((s) => s.text)).toEqual(Y6_ANIMALS);
    // All of the year's statements, not a topic subset: Year 6 plus upper KS2 working scientifically.
    expect(r.statements.length).toBe(15 + 6);
    expect(new Set(r.statements.map((s) => s.id)).size).toBe(r.statements.length);
  });

  test("a heading match ranks above a statement-text match; no topic keeps source order", () => {
    const light = curriculumFor({
      country: "england",
      subject: "science",
      yearGroup: "Y6",
      topic: "Light",
    });
    expect(light.matchedDomains[0]).toBe("Light");
    const plain = curriculumFor({ country: "england", subject: "science", yearGroup: "6" });
    expect(plain.matchedDomains).toEqual([]);
    expect(plain.statements[0]?.domain).toBe("Working scientifically");
  });

  test("is deterministic", () => {
    const q = { country: "England", subject: "maths", yearGroup: "Year 4", topic: "Fractions" };
    expect(curriculumFor(q)).toEqual(curriculumFor(q));
    expect(curriculumFor(q).matchedDomains[0]).toBe("Number - fractions (including decimals)");
  });

  test("no data: another country, an unknown subject, Reception, Year 12", () => {
    const none = { statements: [], matchedDomains: [] };
    expect(curriculumFor({ country: "india", subject: "science", yearGroup: "Year 6" })).toEqual(
      none,
    );
    expect(curriculumFor({ country: "england", subject: "RE", yearGroup: "Year 6" })).toEqual(none);
    expect(
      curriculumFor({ country: "england", subject: "science", yearGroup: "Reception" }),
    ).toEqual(none);
    expect(curriculumFor({ country: "england", subject: "science", yearGroup: "Year 12" })).toEqual(
      none,
    );
  });

  test("subject aliases and year parsing", () => {
    expect(curriculumSubject("PE")).toBe("physical education");
    expect(curriculumSubject("French")).toBe("languages");
    expect(curriculumSubject("english")).toBe("English");
    expect(curriculumYear("Year 10")).toBe(10);
    expect(curriculumYear("Y3")).toBe(3);
    expect(curriculumYear("Reception")).toBeUndefined();
  });
});

describe("curriculumBlock and the objectives user turn", () => {
  afterEach(() => setLocale(ENGLAND));

  const heart = () =>
    sampleBriefLesson({
      yearGroup: "Year 6",
      ageBand: "ks2",
      brief: { topic: "The heart and circulatory system", durationMin: 60 },
    });

  test("the block groups statements under their heading, the matched domain first", () => {
    const r = curriculumFor({
      country: "england",
      subject: "science",
      yearGroup: "Year 6",
      topic: "The heart and circulatory system",
    });
    const block = curriculumBlock(r, "Year 6");
    expect(block.split("\n").slice(0, 5)).toEqual([
      "Curriculum statements (statutory, Year 6 science):",
      "Animals including humans",
      ...Y6_ANIMALS.map((t) => `- ${t}`),
    ]);
    expect(curriculumBlock({ statements: [], matchedDomains: [] }, "Year 6")).toBe("");
  });

  test("the current template has no {{curriculum}}: the user turn is unchanged", () => {
    const P = writerBundle();
    expect(P.objectivesUser).not.toContain("{{curriculum}}");
    expect(writerObjectivesUser(heart())).not.toContain("Curriculum statements");
  });

  test("a template with {{curriculum}} gets the statements; no data renders nothing", () => {
    const template = "Topic: {{topic}}\n{{curriculum}}";
    const filled = writerObjectivesUser(heart(), template);
    expect(filled).toContain("Curriculum statements (statutory, Year 6 science):");
    expect(filled).toContain(`- ${Y6_ANIMALS[1]}`);
    setLocale(INDIA);
    expect(writerObjectivesUser(heart(), template)).toBe("Topic: The heart and circulatory system");
  });
});
