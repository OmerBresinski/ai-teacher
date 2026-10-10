import { afterEach, describe, expect, test } from "bun:test";
import { writerObjectivesUser } from "../stages/objectives";
import { sampleBriefLesson } from "../testing";
import { writerBundle } from "../writer/bundle";
import { ENGLAND, INDIA, setLocale } from "../writer/locale";
import {
  CURRICULUM,
  CURRICULUM_FILES,
  CURRICULUM_OTHER_CAP,
  CurriculumFileSchema,
  curriculumBlock,
  curriculumFor,
  curriculumSubject,
  curriculumYear,
  curriculumYears,
  SUBJECT_ALIASES,
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
    expect(r.years).toEqual([6, 6]);
    expect(r.matchedDomains).toEqual(["Animals including humans"]);
    expect(r.statements.slice(0, 3).map((s) => s.text)).toEqual(Y6_ANIMALS);
    // The matched domain whole, then the capped rest: not the year's 21 statements.
    expect(r.statements.length).toBe(3 + CURRICULUM_OTHER_CAP);
    expect(new Set(r.statements.map((s) => s.id)).size).toBe(r.statements.length);
  });

  test("Year 4 rivers: the geography domains naming rivers first, the rest capped", () => {
    const r = curriculumFor({
      country: "england",
      subject: "Geography",
      yearGroup: "Year 4",
      topic: "Rivers",
    });
    expect(r.matchedDomains).toEqual(["Locational knowledge", "Human and physical geography"]);
    expect(r.statements[0]?.domain).toBe("Locational knowledge");
    expect(r.statements.some((s) => /rivers/.test(s.text))).toBe(true);
    const all = curriculumFor({ country: "england", subject: "Geography", yearGroup: "Year 4" });
    expect(r.statements.length).toBeLessThanOrEqual(all.statements.length);
    const matched = r.statements.filter((s) => r.matchedDomains.includes(s.domain)).length;
    expect(r.statements.length - matched).toBeLessThanOrEqual(CURRICULUM_OTHER_CAP);
  });

  test("Year 4 fractions: the fractions domain whole, then at most the cap of the year's rest", () => {
    const r = curriculumFor({
      country: "england",
      subject: "maths",
      yearGroup: "Year 4",
      topic: "Fractions",
    });
    const domain = "Number - fractions (including decimals)";
    expect(r.matchedDomains).toEqual([domain]);
    const inDomain = CURRICULUM.filter(
      (s) => s.subject === "mathematics" && s.years[0] === 4 && s.domain === domain,
    );
    expect(r.statements.slice(0, inDomain.length)).toEqual(inDomain);
    expect(r.statements.length).toBe(inDomain.length + CURRICULUM_OTHER_CAP);
    const all = curriculumFor({ country: "england", subject: "maths", yearGroup: "Year 4" });
    expect(r.statements.length).toBeLessThan(all.statements.length);
  });

  test("a key stage 4 topic matched only in statement text stays short", () => {
    const all = curriculumFor({ country: "england", subject: "maths", yearGroup: "Year 11" });
    const r = curriculumFor({
      country: "england",
      subject: "maths",
      yearGroup: "Year 11",
      topic: "Fractions",
    });
    expect(r.statements.length).toBeLessThan(all.statements.length / 2);
    expect(r.statements[0]?.text).toMatch(/fraction/);
  });

  test("a heading match ranks above a statement-text match; no topic keeps source order", () => {
    const light = curriculumFor({
      country: "england",
      subject: "science",
      yearGroup: "Y6",
      topic: "Light",
    });
    expect(light.matchedDomains).toEqual(["Light"]);
    const plain = curriculumFor({ country: "england", subject: "science", yearGroup: "6" });
    expect(plain.matchedDomains).toEqual([]);
    expect(plain.statements[0]?.domain).toBe("Working scientifically");
  });

  test("is deterministic", () => {
    const q = { country: "England", subject: "maths", yearGroup: "Year 4", topic: "Fractions" };
    expect(curriculumFor(q)).toEqual(curriculumFor(q));
    expect(curriculumFor(q).matchedDomains[0]).toBe("Number - fractions (including decimals)");
  });

  test("a key stage or a year range gets every year's statements in it", () => {
    const ks2 = curriculumFor({ country: "england", subject: "geography", yearGroup: "KS2" });
    expect(ks2.years).toEqual([3, 6]);
    expect(ks2.statements.length).toBe(10);
    const y56 = curriculumFor({ country: "england", subject: "science", yearGroup: "Years 5-6" });
    expect(y56.years).toEqual([5, 6]);
    const y5 = curriculumFor({ country: "england", subject: "science", yearGroup: "Year 5" });
    const y6 = curriculumFor({ country: "england", subject: "science", yearGroup: "Year 6" });
    expect(new Set(y56.statements.map((s) => s.id))).toEqual(
      new Set([...y5.statements, ...y6.statements].map((s) => s.id)),
    );
  });

  test("no data: another country, an unknown subject, Reception, EYFS, Year 12", () => {
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
    for (const yearGroup of ["EYFS", "Nursery", "", "Key Stage 5"]) {
      expect(curriculumFor({ country: "england", subject: "science", yearGroup })).toEqual(none);
    }
  });

  test("every subject alias resolves to a subject with data", () => {
    const aliases: Record<string, string> = {
      maths: "mathematics",
      math: "mathematics",
      biology: "science",
      chemistry: "science",
      physics: "science",
      art: "art and design",
      dt: "design and technology",
      "d&t": "design and technology",
      "design technology": "design and technology",
      pe: "physical education",
      "p.e.": "physical education",
      mfl: "languages",
      "modern foreign languages": "languages",
      "foreign languages": "languages",
      french: "languages",
      spanish: "languages",
      german: "languages",
      "english language": "English",
      "english literature": "English",
    };
    expect(Object.keys(aliases).sort()).toEqual(Object.keys(SUBJECT_ALIASES).sort());
    for (const [alias, subject] of Object.entries(aliases)) {
      expect(curriculumSubject(alias)).toBe(subject);
      expect(curriculumSubject(alias.toUpperCase())).toBe(subject);
    }
    expect(curriculumSubject("English Language")).toBe("English");
    expect(
      curriculumFor({ country: "england", subject: "English Literature", yearGroup: "Year 10" })
        .statements.length,
    ).toBe(38);
    expect(curriculumSubject("english")).toBe("English");
    expect(curriculumSubject("RE")).toBeUndefined();
  });

  test("year group parsing: single years, ranges, key stages; Reception and EYFS read as none", () => {
    expect(curriculumYears("Year 10")).toEqual([10, 10]);
    expect(curriculumYears("Y3")).toEqual([3, 3]);
    expect(curriculumYears("6")).toEqual([6, 6]);
    expect(curriculumYears("Years 5-6")).toEqual([5, 6]);
    expect(curriculumYears("Year 5/6")).toEqual([5, 6]);
    expect(curriculumYears("Y5/6")).toEqual([5, 6]);
    expect(curriculumYears("Years 5 to 6")).toEqual([5, 6]);
    expect(curriculumYears("KS1")).toEqual([1, 2]);
    expect(curriculumYears("KS2")).toEqual([3, 6]);
    expect(curriculumYears("Key Stage 2")).toEqual([3, 6]);
    expect(curriculumYears("key stage 3")).toEqual([7, 9]);
    expect(curriculumYears("KS4")).toEqual([10, 11]);
    for (const none of ["Reception", "EYFS", "Nursery", "Year 12", "Years 6-5", "Year 0", ""]) {
      expect(curriculumYears(none)).toBeUndefined();
    }
    expect(curriculumYear("Year 10")).toBe(10);
    expect(curriculumYear("Years 5-6")).toBeUndefined();
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
