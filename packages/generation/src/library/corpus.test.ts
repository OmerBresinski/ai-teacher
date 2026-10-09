import { expect, test } from "bun:test";
import { MODEL_LOADERS } from "./models";
import { kit, libraryDom, loadModel, renderLibraryModel } from "./render";
import { TARGETED } from "./vendor/tools/corpus-cases";

/*
 * The library's flexibility corpus (lab/library/tools/corpus.test.ts) for the shipped models, run
 * on the worker's DOM instead of Chromium: every preset filled with off-menu names, the longest
 * labels, the fewest and the most items and the extreme numbers, plus the flex audit's worst cases.
 * Nothing throws; every named picture is in the alt text; the audit cases draw a card where the art
 * is wrong, never say the wrong thing's name, or are refused. (The lab's clipping ratchet measures
 * text in Chromium and stays in the lab.)
 */
type R = {
  id: string;
  label: string;
  threw?: string;
  refused?: string;
  expect?: string;
  said?: string[];
  notCard?: string[];
  altMiss?: string[];
};

test("flexibility corpus, shipped models", async () => {
  await kit(); // the kit's import-time stubs first, then the lab's runner (untyped JS)
  // @ts-expect-error the lab's corpus runner is untyped JS (vendored from lab/library/tools)
  const CO = await import("./vendor/tools/corpus.js");
  const { win, host } = libraryDom();
  host.setAttribute("id", "host");
  const g = globalThis as Record<string, unknown>;
  // The runner reads styles to skip hidden text; only the slide's tokens need the real cascade.
  const real = (el: unknown) => win.getComputedStyle(el as never);
  g.document = win.document;
  g.getComputedStyle = (el: { classList?: { contains: (c: string) => boolean } }) =>
    el?.classList?.contains("slide") || el === win.document.documentElement
      ? real(el)
      : { display: "", visibility: "", opacity: "1", getPropertyValue: () => "" };
  const results: R[] = [];
  try {
    const ids = (CO.ids() as string[]).filter((id) => MODEL_LOADERS[id]);
    expect(ids.length).toBe(Object.keys(MODEL_LOADERS).length);
    for (const id of ids) {
      const cases = [
        ...((await CO.casesFor(id)) as object[]),
        ...TARGETED.filter((t) => t.id === id),
      ] as { label: string; expect?: string }[];
      for (const c of cases) {
        let r: R;
        try {
          r = (await CO.runCase(c)) as R;
        } catch (e) {
          r = { id, label: c.label, threw: String(e).slice(0, 200) };
        }
        r.expect = c.expect;
        results.push(r);
      }
    }
  } finally {
    delete g.document;
    delete g.getComputedStyle;
  }
  const key = (r: R) => `${r.id} | ${r.label}`;
  expect(results.length).toBeGreaterThan(900);
  expect(results.filter((r) => r.threw).map((r) => `${key(r)}: ${r.threw}`)).toEqual([]);
  const targeted = results.filter((r) => r.expect);
  expect(targeted.length).toBe(TARGETED.filter((t) => MODEL_LOADERS[t.id]).length);
  expect(
    targeted
      .filter(
        (r) => (r.expect === "refused") !== !!r.refused || r.said?.length || r.notCard?.length,
      )
      .map((r) => `${key(r)}: refused=${!!r.refused} said=${r.said} notCard=${r.notCard}`),
  ).toEqual([]);
  expect(results.filter((r) => r.altMiss?.length).map((r) => `${key(r)}: ${r.altMiss}`)).toEqual(
    [],
  );
}, 600_000);

/*
 * Fit on the corpus extremes (each model's first preset as is, with the longest labels and with the
 * extreme numbers): no word is drawn off the slide or below its foot, measured with the Lexend
 * advance tables the worker lays out with. The same cases were checked against the lab's Chromium
 * render, pixel for pixel, when this shipped (PR #422).
 */
test("corpus extremes: no words off the slide", async () => {
  await kit();
  // @ts-expect-error the lab's corpus runner is untyped JS (vendored from lab/library/tools)
  const CO = await import("./vendor/tools/corpus.js");
  const { win } = libraryDom();
  const g = globalThis as Record<string, unknown>;
  const off: string[] = [];
  let drawn = 0;
  for (const id of Object.keys(MODEL_LOADERS)) {
    const m = await loadModel(id);
    const first = m?.presets[0]?.id;
    g.document = win.document;
    g.getComputedStyle = (el: unknown) => win.getComputedStyle(el as never);
    const cases = (
      (await CO.casesFor(id)) as { label: string; params: Record<string, unknown> }[]
    ).filter((c) =>
      [" as is", " longLabels max", " oddNumbers max"].some((s) => c.label === `${first}${s}`),
    );
    delete g.document;
    delete g.getComputedStyle;
    for (const c of cases) {
      if (!m?.validate(c.params).ok) continue;
      const r = await renderLibraryModel(id, c.params).catch(() => undefined);
      if (!r) continue;
      drawn++;
      off.push(...r.offSlide.map((w) => `${id} | ${c.label}: ${w}`));
    }
  }
  expect(drawn).toBeGreaterThan(100);
  expect(off).toEqual([]);
}, 600_000);
