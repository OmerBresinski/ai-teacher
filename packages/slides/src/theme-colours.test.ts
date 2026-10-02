import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { docFromText } from "./factories";
import { themedColour, withThemeColours } from "./theme-colours";
import { getTheme, THEMES } from "./themes";

/*
 * `withThemeColours` reads any colour that is some theme's token as that token. It is not the
 * identity in a lesson's own theme: a hex two themes give to different tokens is read as the token
 * that comes first, so the theme that uses it for the other token draws it differently. These
 * cases pin exactly where that happens, teacher colours included.
 */

const colourTokens = (themeId: string) =>
  Object.entries(getTheme(themeId).colors).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].startsWith("#"),
  );

describe("withThemeColours in a lesson's own theme", () => {
  test("every theme but exam-hall draws its own tokens unchanged", () => {
    for (const theme of THEMES.filter((t) => t.id !== "exam-hall")) {
      for (const [token, hex] of colourTokens(theme.id)) {
        expect(themedColour(hex, theme), `${theme.id} ${token}`).toBe(hex);
      }
    }
  });

  test("exam-hall: its white (background and onAccent) is drawn as its surface, #F3F5F8", () => {
    const exam = getTheme("exam-hall");
    const moved = colourTokens("exam-hall").filter(([, hex]) => themedColour(hex, exam) !== hex);
    expect(moved.map(([token]) => token).sort()).toEqual(["background", "onAccent"]);
    for (const [, hex] of moved) expect(themedColour(hex, exam)).toBe("#F3F5F8");
  });

  test("exam-hall: a teacher's #FFFFFF text box and text mark are drawn #F3F5F8", () => {
    const exam = getTheme("exam-hall");
    const doc = docFromText("White on navy");
    const marked = {
      ...doc,
      content: doc.content?.map((p) => ({
        ...p,
        content: p.content?.map((t) => ({
          ...t,
          marks: [{ type: "textStyle", attrs: { color: "#FFFFFF" } }],
        })),
      })),
    };
    const box = {
      id: "t",
      type: "text",
      x: 0,
      y: 0,
      w: 400,
      h: 60,
      doc: marked,
      style: { preset: "body", color: "#FFFFFF" },
    } as unknown as TextElement;
    const slide: Slide = { id: "s", kind: "content", elements: [box] };
    const [drawn] = withThemeColours(slide, exam).elements as TextElement[];
    expect(drawn?.style.color).toBe("#F3F5F8");
    const mark = drawn?.doc.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark?.attrs?.color).toBe("#F3F5F8");
    // The editor's copy keeps the stored doc (its Tiptap editors save what they were seeded with)
    // and themes the rest.
    const [edited] = withThemeColours(slide, exam, { docs: false }).elements as TextElement[];
    expect(edited?.doc).toBe(box.doc);
    expect(edited?.style.color).toBe("#F3F5F8");
  });

  test("a colour no theme uses is the teacher's own and is left as it is", () => {
    for (const theme of THEMES) expect(themedColour("#123456", theme)).toBe("#123456");
  });
});
