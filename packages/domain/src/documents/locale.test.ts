import { describe, expect, test } from "bun:test";
import { lessonFromBrief } from "./create-lesson";
import {
  COUNTRIES,
  countryFromGeo,
  DEFAULT_COUNTRY,
  LOCALE_LIST,
  localeFor,
  speaksLikeEngland,
} from "./locale";

describe("localeFor (TEACH-33 part b)", () => {
  test.each([
    ["england", "en-GB", "British English", "£", "metric", "Year", "NC2014"],
    ["wales", "en-GB", "British English", "£", "metric", "Year", "CfW"],
    ["scotland", "en-GB", "British English", "£", "metric", "P", "CfE"],
    ["northern-ireland", "en-GB", "British English", "£", "metric", "P", "NIC"],
    ["ireland", "en-IE", "Irish English", "€", "metric", "Class", "NCCA"],
    ["india", "en-IN", "Indian English", "₹", "metric", "Class", "CBSE"],
    ["usa", "en-US", "American English", "$", "us-customary", "Grade", "CCSS"],
    ["australia", "en-AU", "Australian English", "$", "metric", "Year", "ACARA"],
    ["new-zealand", "en-NZ", "New Zealand English", "$", "metric", "Year", "NZC"],
  ] as const)("%s", (country, language, spelling, symbol, units, word, scheme) => {
    const l = localeFor(country);
    expect(l.country).toBe(country);
    expect(l.language).toBe(language);
    expect(l.spelling).toBe(spelling);
    expect(l.currency.symbol).toBe(symbol);
    expect(l.units).toBe(units);
    expect(l.yearNaming.word).toBe(word);
    expect(l.curriculum.scheme).toBe(scheme);
  });

  test("England is the default, for a missing or unknown country", () => {
    expect(DEFAULT_COUNTRY).toBe("england");
    for (const c of [undefined, null, "", "atlantis"]) expect(localeFor(c).country).toBe("england");
  });

  test("every country has a locale, listed in order", () => {
    expect(LOCALE_LIST.map((l) => l.country)).toEqual([...COUNTRIES]);
  });

  test("the UK nations word prompts exactly as England does; the others do not", () => {
    const same = LOCALE_LIST.filter(speaksLikeEngland).map((l) => l.country);
    expect(same).toEqual(["england", "wales", "scotland", "northern-ireland"]);
  });
});

describe("lessonFromBrief country defaults", () => {
  const input = { brief: { topic: "Money" }, yearGroup: "Year 5" } as const;
  const now = new Date("2026-10-07T10:00:00Z");

  test("no country: England, en-GB, as before", () => {
    const lesson = lessonFromBrief(input, "l1", now);
    expect(lesson.country).toBe("england");
    expect(lesson.language).toBe("en-GB");
    expect(lesson.yearGroup).toBe("Year 5");
  });

  test("India: en-IN and the country on the lesson", () => {
    const lesson = lessonFromBrief(input, "l1", now, "india");
    expect(lesson.country).toBe("india");
    expect(lesson.language).toBe("en-IN");
  });

  test("a language the request names wins over the country's", () => {
    const lesson = lessonFromBrief({ ...input, language: "cy" }, "l1", now, "india");
    expect(lesson.language).toBe("cy");
    expect(lesson.country).toBe("india");
  });
});

describe("countryFromGeo (geolocated default)", () => {
  test.each([
    ["IN", undefined, "india"],
    ["in", undefined, "india"],
    ["IE", undefined, "ireland"],
    ["US", "CA", "usa"],
    ["AU", undefined, "australia"],
    ["NZ", undefined, "new-zealand"],
    ["GB", "SCT", "scotland"],
    ["GB", "GB-WLS", "wales"],
    ["GB", "NIR", "northern-ireland"],
    ["GB", "ENG", "england"],
    ["GB", undefined, "england"],
    ["FR", undefined, "england"],
    ["", undefined, "england"],
    [null, undefined, "england"],
    [undefined, undefined, "england"],
  ] as const)("%s/%s → %s", (iso, region, expected) => {
    expect(countryFromGeo(iso, region)).toBe(expected);
  });
});
