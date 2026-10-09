import { expect, test } from "bun:test";
import { markKept, type TeacherRun } from "./teacher";

const edits = (): TeacherRun["edits"] => [
  { marker: "TPFIRST", slide: 1, typedAtS: 40, kept: null },
  { marker: "TPLAST", slide: 10, typedAtS: 41, kept: null },
  { marker: "TPNEVER", slide: 2, typedAtS: null, kept: null },
];

test("an edit is kept only if the reloaded document holds it", () => {
  const e = edits();
  markKept(e, { slides: [{ elements: [{ doc: { text: "Title TPFIRST" } }] }] });
  expect(e.map((x) => x.kept)).toEqual([true, false, null]);
});

test("no document read back means nothing was saved, whatever the page showed", () => {
  const e = edits();
  markKept(e, null);
  expect(e.map((x) => x.kept)).toEqual([false, false, null]);
});
