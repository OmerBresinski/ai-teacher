import { describe, expect, test } from "bun:test";
import { routeEdit } from "./edit-route";

describe("routeEdit (TEACH-97)", () => {
  test.each([
    ["element", "Make it shorter", { path: "fast" }],
    ["slide", "Turn it into a question", { path: "fast" }],
    ["element", "undo that", { path: "undo" }],
    ["slide", "Put it back", { path: "undo" }],
    ["lesson", "Make it easier", { path: "agent", need: "lesson" }],
    ["slide", "Add a practice slide after this one", { path: "agent", need: "slides" }],
    ["slide", "Add a picture of a kettle", { path: "agent", need: "picture" }],
    ["slide", "Animate the particles", { path: "agent", need: "animation" }],
    ["slide", "Use a bar model instead", { path: "agent", need: "diagram" }],
    ["element", "Cite a source for this", { path: "agent", need: "source" }],
  ] as const)("%s: %s", (scope, instruction, expected) => {
    expect(routeEdit(scope, instruction)).toEqual(expected);
  });
});
