import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { endDrawThread } from "./guard";
import { MODEL_LOADERS } from "./models";
import { kit, loadModel, renderLibraryModel } from "./render";

/*
 * TEACH-247 part x, the kit contract from the library audit (fix list item 26).
 *
 * 1. Every caption has its own frame. Each of a model's `builds().steps` is one Next in Present,
 *    so the frames Present plays are the steps, plus at most one more for the summary when it
 *    adds a mark of its own. Fewer frames than steps means two captioned ideas share a frame.
 * 2. The last click keeps the lesson. The final frame keeps every word of the frame before it
 *    that a caption names, so a build never ends by taking away the roles, count or list its
 *    captions built up. (A tray label that goes once the tray is empty is not named, so it may go.)
 *
 * Presets that still break a rule are listed below with the group that owns the model's fix.
 * A listed preset that now keeps the rule fails the test, so its entry is removed when fixed.
 */

/** The owners, by the audit's ranked fix list (scratchpad/quality-prd/LIBRARY-AUDIT.md). */
const OWNER = {
  equal_groups: "fix list 3 (equal_groups)",
  light_shadows: "fix list 5 (light_shadows)",
  algorithm_grid: "fix list 6 (algorithm_grid)",
  mixtures_separating: "fix list 7 (mixtures_separating)",
  angles_turns: "fix list 8 (angles_turns)",
  evolution_adaptation: "fix list 9 (evolution_adaptation)",
  microhabitat_survey: "fix list 10 (microhabitat_survey)",
  clock_time: "fix list 11 (clock_time)",
  measuring_scales: "fix list 12 (measuring_scales)",
  food_chain: "fix list 13 (food_chain)",
  classify_key: "fix list 14 (classify_key)",
  body_map: "fix list 17 (body_map)",
  balance_equations: "fix list 18 (balance_equations)",
  materials_test: "fix list 19 (materials_test)",
  volcano_earthquake: "fix list 22 (volcano_earthquake)",
  rivers_coasts: "fix list 23 (rivers_coasts)",
  number_bonds: "fix list 25 (small fixes)",
  coordinate_grid: "fix list 25 (small fixes)",
  shape_3d_nets: "fix list 25 (small fixes)",
  map_skills: "fix list 25 (small fixes)",
  forces_magnets: "fix list 25 (small fixes)",
  circuits: "fix list 25 (small fixes)",
  seasons_weather: "fix list 25 (small fixes)",
  climate_biomes: "fix list 25 (small fixes)",
  rhythm_grid: "fix list 25 (small fixes)",
  community_helpers: "fix list 25 (small fixes)",
  data_chart: "fix list 25 (small fixes)",
  place_value: "TEACH-247 part y follow-up (place_value)",
} as const;
type Owned = keyof typeof OWNER;

/** model/preset: two or more captions share a frame. */
const SHARED_FRAME: Record<string, Owned> = {
  "shape_3d_nets/rec-roll-stack": "shape_3d_nets", // 6 captions, 5 frames
  "shape_3d_nets/y4-prisms-pyramids": "shape_3d_nets", // 6 captions, 5 frames
  "shape_3d_nets/y6-cube-nets": "shape_3d_nets", // 6 captions, 3 frames
  "coordinate_grid/rec-bee-forward": "coordinate_grid", // 3 captions, 2 frames
  "body_map/reception-my-body": "body_map", // 9 captions, 8 frames
  "body_map/y1-senses": "body_map", // 6 captions, 5 frames
  "body_map/y3-skeleton-muscles": "body_map", // 8 captions, 7 frames
  "forces_magnets/y5-parachutes": "forces_magnets", // 5 captions, 3 frames
};
/** model/preset: the last click takes away words a caption names. */
const LAST_CLICK_DROPS: Record<string, Owned> = {
  "clock_time/y1-oclock-half-past": "clock_time", // drops 3 o’clock
  "clock_time/y3-how-long": "clock_time", // drops 10:40 am, 20 minutes to 11
  "angles_turns/y6-missing-line": "angles_turns", // drops a
  "data_chart/y1-fruit": "data_chart", // drops 5 children
  "data_chart/y2-books": "data_chart", // drops 4 × 2 + 1 = 9
  "data_chart/y6-travel": "data_chart", // drops 360° ÷ 30 = 12°
  "mixtures_separating/y3-magnet": "mixtures_separating", // drops A magnet
  "mixtures_separating/y5-filter": "mixtures_separating", // drops Filter paper in a funnel
  "volcano_earthquake/y3-inside": "volcano_earthquake", // drops Lava
  "volcano_earthquake/y4-pompeii": "volcano_earthquake", // drops Ash and pumice
};
/** model/preset: the last click replaces a named word on purpose, and the pupil sees why. */
const MORPH: Record<string, string> = {
  "counting_subitising/rec-dice": "one more: the 5 becomes 6 as the sixth dot is added",
  "counting_subitising/rec-fingers": "one less: the 7 becomes 6 as a finger goes down",
  "fractions/y1-half-pizza": "the whole pizza is cut: its two halves replace “One pizza”",
  "number_bonds/rec-bonds-5": "every bond to 5: the tree becomes the list, 3 + 2 picked out in it",
  "number_bonds/y1-bonds-10": "every bond to 10: the tree becomes the list, 7 + 3 picked out in it",
  "place_value/y3-exchange": "the exchange: a ten moves across, so 5 and 2 become 4 and 12",
};

/** The words Present shows at frame `k` (the markup's `data-s` / `data-f` / `data-x` frames). */
function wordsAt(svg: string, k: number): string[] {
  const doc = new Window().document;
  doc.body.innerHTML = svg.replace(/<style>[\s\S]*?<\/style>/g, "");
  const nums = (v: string | null) => (v ?? "").split(" ").filter(Boolean).map(Number);
  for (const el of [...doc.querySelectorAll("[data-s],[data-f],[data-x],[data-reveal]")])
    if (
      Number(el.getAttribute("data-s") ?? 0) > k ||
      (el.hasAttribute("data-f") && !nums(el.getAttribute("data-f")).includes(k)) ||
      nums(el.getAttribute("data-x")).includes(k) ||
      el.hasAttribute("data-reveal")
    )
      el.remove();
  return [...doc.querySelectorAll("text")]
    .map((t) => (t.textContent ?? "").trim())
    .filter((w) => /\p{L}|\d/u.test(w));
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The words the frame before the last shows that the last one drops while a caption names them. */
function droppedWords(svg: string, last: number, captions: string[]): string[] {
  const end = wordsAt(svg, last);
  return wordsAt(svg, last - 1).filter(
    (w) =>
      !end.includes(w) &&
      captions.some((c) => new RegExp(`(^|[^\\p{L}\\d])${esc(w)}($|[^\\p{L}\\d])`, "iu").test(c)),
  );
}

afterAll(() => endDrawThread());

describe("the kit contract (TEACH-247 part x)", () => {
  test("every caption has its own frame, and the last click keeps the lesson", async () => {
    const K = await kit();
    const shared: string[] = [];
    const drops: string[] = [];
    const report: string[] = [];
    for (const id of Object.keys(MODEL_LOADERS)) {
      const m = await loadModel(id);
      if (!m?.builds) continue;
      for (const p of m.presets) {
        const key = `${id}/${p.id}`;
        const P = K.withDefaults(m.params, p.params);
        const plan = m.builds(P) as {
          steps: { caption?: string }[];
          summary?: { caption?: string };
        };
        const steps = plan.steps.length;
        const captions = [...plan.steps.map((s) => s.caption), plan.summary?.caption].filter(
          (c): c is string => Boolean(c),
        );
        const d = await renderLibraryModel(id, P);
        const frames = d.builds + 1;
        if (frames < steps || frames > steps + 1) {
          shared.push(key);
          report.push(`${key}: ${steps} captions, ${frames} frames`);
        }
        const gone = d.builds > 0 ? droppedWords(d.svg, d.builds, captions) : [];
        if (gone.length && !MORPH[key]) {
          drops.push(key);
          report.push(`${key}: the last click drops ${gone.join(", ")}`);
        }
      }
    }
    if (report.length) console.log(report.join("\n"));
    expect(shared.sort()).toEqual(Object.keys(SHARED_FRAME).sort());
    expect(drops.sort()).toEqual(Object.keys(LAST_CLICK_DROPS).sort());
  }, 300_000);

  test("every listed preset names the group that owns its model", () => {
    for (const [key, owner] of Object.entries({ ...SHARED_FRAME, ...LAST_CLICK_DROPS })) {
      expect(key.split("/")[0]).toBe(owner);
      expect(OWNER[owner]).toBeTruthy();
    }
  });
});
