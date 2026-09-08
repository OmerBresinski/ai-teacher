import { describe, expect, test } from "bun:test";
import { repairJsonText } from "./repair-json";

const answer = {
  learningObjectives: [{ text: "Describe a derivative as a rate of change" }],
  outline: [
    { kind: "title", minutes: 2, factRefs: [] },
    { kind: "objectives", minutes: 3, factRefs: [{ type: "objective", index: 0 }] },
  ],
};

describe("repairJsonText", () => {
  test("a list given as a JSON string is parsed in place", () => {
    const text = JSON.stringify({
      learningObjectives: JSON.stringify(answer.learningObjectives),
      outline: answer.outline,
    });
    const repaired = repairJsonText(text);
    expect(repaired.repairs).toEqual(["parsed-string"]);
    expect(JSON.parse(repaired.text as string)).toEqual(answer);
  });

  test("the whole answer given as a string under its first key is hoisted", () => {
    const text = JSON.stringify({ learningObjectives: JSON.stringify(answer) });
    const repaired = repairJsonText(text);
    expect(repaired.repairs).toEqual(["parsed-string", "hoisted"]);
    expect(JSON.parse(repaired.text as string)).toEqual(answer);
  });

  test("embedded strings are parsed inside arrays and nested objects too", () => {
    const text = JSON.stringify({
      vocabulary: [{ term: "gradient", definition: "steepness" }],
      workedExamples: [{ problem: "p", steps: JSON.stringify(["a", "b"]), answer: "c" }],
    });
    const repaired = repairJsonText(text);
    expect(repaired.repairs).toEqual(["parsed-string"]);
    expect(JSON.parse(repaired.text as string).workedExamples[0].steps).toEqual(["a", "b"]);
  });

  test("prose strings, even ones starting with a bracket, are left alone", () => {
    const text = JSON.stringify({ message: "[sic] the brief is fine", other: "{not json" });
    expect(repairJsonText(text)).toEqual({ text: null, repairs: [] });
  });

  test("the answer under one made-up key is hoisted, as an object or as a string", () => {
    const asObject = repairJsonText(JSON.stringify({ plan: answer }));
    expect(asObject.repairs).toEqual(["hoisted"]);
    expect(JSON.parse(asObject.text as string)).toEqual(answer);
    const asString = repairJsonText(JSON.stringify({ result: JSON.stringify(answer) }));
    expect(asString.repairs).toEqual(["parsed-string", "hoisted"]);
    expect(JSON.parse(asString.text as string)).toEqual(answer);
  });

  test("a single key holding a list or a scalar is not hoisted", () => {
    expect(repairJsonText(JSON.stringify({ findings: [] }))).toEqual({ text: null, repairs: [] });
    expect(repairJsonText(JSON.stringify({ answer: "ok" }))).toEqual({ text: null, repairs: [] });
  });

  test("an inherited name is an own key like any other; a prototype name is not read", () => {
    const text = JSON.stringify({ toString: answer });
    const repaired = repairJsonText(text);
    expect(repaired.repairs).toEqual(["hoisted"]);
    expect(JSON.parse(repaired.text as string)).toEqual(answer);
  });

  test("valid JSON with nothing to repair and non-JSON text both return null", () => {
    expect(repairJsonText(JSON.stringify(answer))).toEqual({ text: null, repairs: [] });
    expect(repairJsonText("Sure! Here is the plan:")).toEqual({ text: null, repairs: [] });
  });
});
