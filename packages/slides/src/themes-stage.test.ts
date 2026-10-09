import { describe, expect, test } from "bun:test";
import {
  atKeyStage,
  BODY_SMALL,
  displayBodyStop,
  fontFloor,
  getTheme,
  KEY_STAGE_TYPE,
  keyStageOf,
  lessonTheme,
  MIN_FONT_SIZE,
  THEMES,
  typeScale,
} from "./themes";

/*
 * The key-stage type scale (lab FIX-TYPE, ported with TEACH-110 part a onto master's model). A
 * catalogue theme reads exactly its own stops, as before; a stage is opt-in, per lesson
 * (`getTheme(id, ageBand)`, `lessonTheme`) or per job (`atKeyStage`, a copy). There is no
 * process-wide stage on master, so two jobs at different stages never share state.
 */
describe("themes with no key stage", () => {
  test("no catalogue theme has a stage or a type scale", () => {
    for (const t of THEMES) {
      expect(keyStageOf(t)).toBeUndefined();
      expect(typeScale(t)).toBeUndefined();
    }
  });

  test("getTheme without an age band is the catalogue theme, sizes unchanged", () => {
    const chalk = getTheme("chalk");
    expect(chalk).toBe(THEMES.find((t) => t.id === "chalk") as never);
    expect(getTheme("chalk", null)).toBe(chalk);
    expect(getTheme("chalk", "not-a-stage")).toBe(chalk);
    const sizes = { ...chalk.sizes };
    expect(JSON.parse(JSON.stringify(chalk.sizes))).toEqual(sizes);
  });

  test("floors and the display body stop are master's", () => {
    expect(fontFloor("body")).toBe(MIN_FONT_SIZE.body);
    expect(displayBodyStop(getTheme("chalk"))).toBeNumber();
  });

  test("an unknown theme id falls back to the first theme", () => {
    expect(getTheme("nope").id).toBe((THEMES[0] as { id: string }).id);
  });
});

describe("a theme bound to a key stage", () => {
  test("getTheme(id, ageBand) reads the stage's scale, one copy per theme and stage", () => {
    const ks1 = getTheme("splash", "KS1");
    expect(keyStageOf(ks1)).toBe("ks1");
    expect(typeScale(ks1)?.body).toBe(KEY_STAGE_TYPE.ks1.body);
    expect(typeScale(ks1)?.bodySmall).toBe(Math.round(KEY_STAGE_TYPE.ks1.body * BODY_SMALL));
    expect(getTheme("splash", "ks1")).toBe(ks1);
  });

  test("the bound theme leaves the catalogue theme untouched", () => {
    getTheme("splash", "ks1");
    expect(keyStageOf(getTheme("splash"))).toBeUndefined();
    expect(typeScale(getTheme("splash"))).toBeUndefined();
  });

  test("lessonTheme reads a lesson's theme at the lesson's key stage", () => {
    const t = lessonTheme({ themeId: "studio", ageBand: "ks3" });
    expect(t.id).toBe("studio");
    expect(typeScale(t)?.body).toBe(25);
    expect(lessonTheme({ themeId: "studio" })).toBe(getTheme("studio"));
  });

  test("display stops scale with the stage and headingDisplay sits over heading", () => {
    const own = getTheme("studio").sizes.heading;
    const s = typeScale(getTheme("studio", "ks1"));
    expect(s?.heading).toBe(Math.round(own * KEY_STAGE_TYPE.ks1.heading));
    expect(s?.headingDisplay).toBeGreaterThan(s?.heading ?? 0);
  });

  test("at a key stage there is no display body stop", () => {
    expect(displayBodyStop(getTheme("chalk", "ks2"))).toBeUndefined();
  });
});

describe("only real key stages bind", () => {
  test("Object.prototype names and other junk are not key stages", () => {
    const chalk = getTheme("chalk");
    for (const band of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "",
      "ks6",
    ]) {
      expect(getTheme("chalk", band)).toBe(chalk);
      expect(atKeyStage(chalk, band)).toBe(chalk);
      expect(typeScale(atKeyStage(chalk, band))).toBeUndefined();
    }
  });
});

describe("the lesson's age bands that are not key stage names", () => {
  test("a sixth-form (post16) lesson reads at KS5 and a Reception (eyfs) one at KS1", () => {
    expect(keyStageOf(getTheme("studio", "post16"))).toBe("ks5");
    expect(getTheme("studio", "post16")).toBe(getTheme("studio", "ks5"));
    expect(keyStageOf(lessonTheme({ themeId: "studio", ageBand: "post16" }))).toBe("ks5");
    expect(keyStageOf(atKeyStage(getTheme("chalk"), "post16"))).toBe("ks5");
    expect(keyStageOf(getTheme("splash", "eyfs"))).toBe("ks1");
  });
});

describe("staged copies (master: no process-wide stage)", () => {
  test("a spread copy of a staged theme keeps its stage", () => {
    const ks1 = atKeyStage(getTheme("splash"), "ks1");
    const copy = { ...ks1, colors: { ...ks1.colors, accent: "#000000" } };
    expect(keyStageOf(copy)).toBe("ks1");
    expect(typeScale(copy)?.body).toBe(33);
    expect(keyStageOf({ ...getTheme("splash", "ks2") })).toBe("ks2");
  });

  test("restaging a staged theme reads the new stage", () => {
    expect(keyStageOf(atKeyStage(getTheme("studio", "ks1"), "ks3"))).toBe("ks3");
  });

  test("two jobs at different stages read their own scale side by side", () => {
    const studio = getTheme("studio");
    const a = atKeyStage(studio, "ks1");
    const b = atKeyStage(studio, "ks3");
    expect(typeScale(a)?.body).toBe(33);
    expect(typeScale(b)?.body).toBe(25);
    expect(typeScale(studio)).toBeUndefined();
  });

  test("fontFloor stays master's at every stage (it reads no theme)", () => {
    atKeyStage(getTheme("studio"), "ks2");
    expect(fontFloor("body")).toBe(MIN_FONT_SIZE.body);
    expect(fontFloor("heading")).toBe(MIN_FONT_SIZE.heading);
  });
});
