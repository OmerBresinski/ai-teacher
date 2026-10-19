import { describe, expect, spyOn, test } from "bun:test";
import { dirOf, isLanguageTag, RTL_LANGUAGES } from "./direction";
import { creditedLesson, generatedLesson, lesson, textElement } from "./fixtures.test-helpers";
import { parseLesson } from "./lesson";
import { RichDocSchema } from "./rich-text";
import { type Slide, SlideSchema } from "./slide";

describe("dirOf", () => {
  test.each([...RTL_LANGUAGES, "ar-EG", "he-IL", "fa-IR", "ur-PK", "AR", "he_IL", "iw", "az-Arab"])(
    "%s is rtl",
    (tag) => expect(dirOf(tag)).toBe("rtl"),
  );

  test.each([
    "en-GB",
    "en",
    "fr-FR",
    "de",
    "zh-Hans",
    "ur-Latn",
    "arn",
    "her",
    "",
    undefined,
    null,
  ])("%p is ltr", (tag) => expect(dirOf(tag)).toBe("ltr"));
});

test("isLanguageTag takes BCP-47 shapes and refuses anything else", () => {
  for (const ok of ["ar", "he-IL", "az-Arab", "zh-Hant-TW"]) expect(isLanguageTag(ok)).toBe(true);
  for (const bad of ["", "a", "ar IL", "<b>", "ar--IL", 7]) expect(isLanguageTag(bad)).toBe(false);
});

/** Every key anywhere in `value`, so a test can say a field was never added. */
const keysIn = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) for (const v of value) keysIn(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  return out;
};

describe("back-compat: a stored lesson without direction fields", () => {
  test.each([
    ["lesson", lesson],
    ["generatedLesson", generatedLesson],
    ["creditedLesson", creditedLesson],
  ])("%s loads unchanged and gains no dir, rtl or lang", (_, make) => {
    const stored = JSON.parse(JSON.stringify(make()));
    const parsed = parseLesson(stored);
    expect(parsed).toEqual(stored);
    const keys = keysIn(parsed);
    for (const k of ["dir", "rtl"]) expect(keys.has(k)).toBe(false);
    // The lesson's own `language` is the only language field it carries.
    expect(keys.has("lang")).toBe(false);
  });
});

const rtlSlide = (): Slide => ({
  id: "s1",
  kind: "content",
  dir: "rtl",
  elements: [
    {
      ...textElement("t1", "x = 3"),
      rtl: "keep",
    } as Slide["elements"][number],
    {
      id: "i1",
      type: "icon",
      x: 10,
      y: 10,
      w: 40,
      h: 40,
      icon: "arrow-right",
      rtl: "flip",
    } as never,
    {
      id: "g1",
      type: "group",
      x: 0,
      y: 0,
      w: 400,
      h: 200,
      dir: "rtl",
      children: [
        {
          ...textElement("g1:a", "مرحبا"),
        } as Slide["elements"][number],
      ],
    },
  ],
});

describe("new fields", () => {
  test("slide stamp, group stamp, element marks and text lang round-trip", () => {
    const slide = rtlSlide();
    const text = slide.elements[0] as Extract<Slide["elements"][number], { type: "text" }>;
    text.style = { ...text.style, lang: "ar" };
    const parsed = SlideSchema.parse(JSON.parse(JSON.stringify(slide)));
    expect(parsed).toEqual(slide);
    expect(parsed.dir).toBe("rtl");
    expect(parsed.elements.map((e) => e.rtl)).toEqual(["keep", "flip", undefined]);
  });

  test("a bad stamp, mark or text lang is refused", () => {
    const bad = (patch: (s: Slide) => void) => {
      const s = rtlSlide();
      patch(s);
      return SlideSchema.safeParse(s).success;
    };
    expect(bad(() => {})).toBe(true);
    expect(bad((s) => Object.assign(s, { dir: "ltr" }))).toBe(false);
    expect(bad((s) => Object.assign(s.elements[0] as object, { rtl: "mirror" }))).toBe(false);
    expect(
      bad((s) => {
        const t = s.elements[0] as { style: object };
        t.style = { ...t.style, lang: "not a tag" };
      }),
    ).toBe(false);
  });

  test("a run lang mark round-trips; a bad one is dropped, keeping the text", () => {
    const doc = (lang: unknown) => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The word " },
            { type: "text", text: "سلام", marks: [{ type: "textStyle", attrs: { lang } }] },
          ],
        },
      ],
    });
    expect(RichDocSchema.parse(doc("ar"))).toEqual(doc("ar") as never);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const dropped = RichDocSchema.parse(doc("<script>")) as ReturnType<typeof doc>;
    warn.mockRestore();
    const run = dropped.content[0]?.content[1];
    expect(run?.text).toBe("سلام");
    const attrs = run?.marks?.[0]?.attrs as { lang?: unknown } | undefined;
    expect(attrs?.lang).toBeUndefined();
  });
});
