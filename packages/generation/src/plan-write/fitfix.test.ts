import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { getTheme, materialiseSlide, slideFits } from "@tj/slides";
import { withAnswersReveal } from "../planner/coded-slides";
import { ASKED_FORMS, renderWritten, withSetTag } from "./fit";
import { isSetForm } from "./menu";
import { adapt, fromTeacher3, placeT3Diagram, t3Fit, withPictureZone } from "./simple";

/* lab/t3 fit-fix: the T3-CAND decks' slides as written, re-run through the fit stage offline. */
const CALLS = `${import.meta.dir}/../../../../../quality-prd/lab/rounds/T3-CAND/calls`;
const DECKS = [
  "y1-science-animals-young",
  "y5-maths-fractions-of-amounts",
  "y7-particle-model-new",
  "y9-weimar",
  "y10-english-tempest-prospero",
  "y11-chemistry-rates-of-reaction",
];
const META = { promptVersion: "p", model: "m", at: "1970-01-01T00:00:00.000Z" };
// Hinges whose four long options fit no layout at the option floor (UX ruling 91): hard failures.
const HARD = new Set([
  "y9-weimar s5",
  "y10-english-tempest-prospero s4",
  "y11-chemistry-rates-of-reaction s4",
]);

describe.skipIf(!existsSync(CALLS))("T3-CAND decks through the fit stage", () => {
  for (const deck of DECKS) {
    test(deck, () => {
      const out = JSON.parse(
        readFileSync(`${CALLS}/T3C-${deck}-generate.calls.jsonl`, "utf8").split("\n")[0] as string,
      ).output;
      out.slides.forEach((raw: Record<string, unknown>, k: number) => {
        const id = `${deck} s${k + 3}`;
        const [light] = fromTeacher3([], { titlePicture: null, slides: [raw as never] }).slides;
        const s = withPictureZone(light as NonNullable<typeof light>);
        const a = adapt(s);
        const f = t3Fit(a.form, a.layout, a.out, s.questions);
        const shown = JSON.stringify({ ...f.out, notes: undefined });
        // Every question (and a hinge's options) stays on the slide, never in the notes.
        if (ASKED_FORMS.has(a.form) || a.form === "discussion") {
          for (const q of s.questions)
            expect(shown, id).toContain(JSON.stringify(q.question).slice(1, -1));
          if (ASKED_FORMS.has(a.form)) expect(f.rung, id).not.toBe("moved");
          if (a.form === "hinge")
            for (const o of a.out.options as { text: string }[])
              expect(shown, id).toContain(o.text);
        }
        if (HARD.has(id)) {
          expect(f.fits, id).toBe(false);
          return;
        }
        const theme = getTheme("chalk");
        const r = renderWritten(f.form, f.layout, f.out);
        let slide = materialiseSlide(r.spec, theme.id, META, undefined, r.variant, r.structure);
        if (isSetForm(f.form)) slide = withSetTag(withAnswersReveal(slide, theme.id), f.form);
        const p = s.picture as { kind?: string; spec?: { kind?: string } } | null;
        if (f.form === "photo" && p?.kind === "diagram" && p.spec?.kind === "table") {
          const d = placeT3Diagram(slide, p.spec, theme);
          if (d.slide) slide = d.slide;
        }
        expect(slideFits(slide, theme, f.rung === "compact" ? 1 : 0).ok, id).toBe(true);
      });
    });
  }

  test("y11 s7's table is not drawn cut: it is refused, and the slide loses the picture", () => {
    const raw = JSON.parse(
      readFileSync(`${CALLS}/T3C-${DECKS[5]}-generate.calls.jsonl`, "utf8").split(
        "\n",
      )[0] as string,
    ).output.slides[4];
    const [light] = fromTeacher3([], { titlePicture: null, slides: [raw] }).slides;
    const s = withPictureZone(light as NonNullable<typeof light>);
    const a = adapt(s);
    const f = t3Fit(a.form, a.layout, a.out);
    const r = renderWritten(f.form, f.layout, f.out);
    const slide = materialiseSlide(r.spec, "chalk", META, undefined, r.variant, r.structure);
    const d = placeT3Diagram(slide, (s.picture as { spec: unknown }).spec, getTheme("chalk"));
    expect(d.slide).toBeUndefined();
    expect(d.reasons).toEqual(["the table is cut at its smallest size"]);
  });
});
