import { describe, expect, test } from "bun:test";
import { boundAgeBand, getTheme, renderTheme, WRITER_STAMP_PREFIX } from "./themes";

/*
 * TEACH-110 part b, row 10: only a lesson the writer planner wrote renders at its key stage. An
 * objectives-first or legacy lesson that carries `ageBand` renders exactly as on master.
 */
const lesson = (planned: string | undefined, ageBand = "ks3", themeId = "studio") => ({
  themeId,
  ageBand,
  ...(planned ? { generation: { promptVersions: { planned } } } : {}),
});

describe("the gated age-band binding", () => {
  test("an objectives-first lesson with ageBand ks3 gets master's theme, unbound", () => {
    for (const planned of [undefined, "plan-objectives.v4+x", "plan.v9"]) {
      const l = lesson(planned);
      expect(boundAgeBand(l)).toBeUndefined();
      expect(renderTheme(l)).toBe(getTheme("studio"));
    }
  });
  test("a writer-stamped lesson renders at its stage", () => {
    for (const band of ["ks1", "ks2", "ks3", "ks4"]) {
      const l = lesson(`${WRITER_STAMP_PREFIX}v1+plan-objectives.v4`, band);
      expect(boundAgeBand(l)).toBe(band);
      expect(renderTheme(l)).toBe(getTheme("studio", band));
    }
  });
  test("a re-theme target keeps the gate", () => {
    const w = lesson(`${WRITER_STAMP_PREFIX}v1+x`, "ks1");
    expect(renderTheme(w, "splash")).toBe(getTheme("splash", "ks1"));
    expect(renderTheme(lesson(undefined, "ks1"), "splash")).toBe(getTheme("splash"));
  });
});
