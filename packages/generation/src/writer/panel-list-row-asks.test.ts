import { describe, expect, test } from "bun:test";
import { getTheme } from "@tj/slides/themes";
import { visualsOf } from "./materialise";

/*
 * TEACH-247 part aj (review on #658): pictures on only some panel-list rows go to the one title
 * panel, and any after the first are left off (`droppedPictures`). A row picture the slide has no
 * place for is never asked for, so no search or generation is spent on a picture that lands
 * nowhere (the myth proof's pattern, TEACH-247 part ae).
 */
type S = Record<string, unknown>;
const INDEX = 7;
const base = {
  brief: {
    id: "t",
    topic: "The Great Fire of London",
    subject: "history",
    yearGroup: "Year 2",
    year: 2,
    keyStage: "ks1",
    theme: "crayon",
    readingLevel: "",
    language: "en-GB",
    durationMin: 60,
    exitTicketOnSlides: true,
  },
  theme: getTheme("crayon"),
  stage: "ks1",
  plan: { flow: [{ slide: INDEX + 1 }], slides: [] },
} as never;
const pic = (shows: string) => ({ shows, must_see: [], subject: "generic" });
const slide = (pictures: (S | null)[], panel: S | null = null): S => ({
  template: "panel-list",
  heading: "Fighting fire",
  items: [
    { name: "Buckets", text: "People threw water onto flames.", picture: pictures[0] ?? null },
    { name: "Fire hooks", text: "People pulled burning wood down.", picture: pictures[1] ?? null },
    { name: "Squirts", text: "People sprayed water by hand.", picture: pictures[2] ?? null },
  ],
  panel,
});
const keys = (s: S) => visualsOf(s, INDEX, base).map((a) => a.key);

describe("panel-list: only the row pictures the slide shows are asked for", () => {
  test("one partial row picture is asked (it shows in the panel)", () => {
    expect(keys(slide([null, pic("A fire hook")]))).toEqual(["row.1"]);
  });
  test("two partial row pictures: the second is left off and never asked", () => {
    expect(keys(slide([null, pic("A fire hook"), pic("A brass squirt")]))).toEqual(["row.1"]);
  });
  test("every row pictured: each row's tile is asked", () => {
    expect(keys(slide([pic("A bucket"), pic("A fire hook"), pic("A squirt")]))).toEqual([
      "row.0",
      "row.1",
      "row.2",
    ]);
  });
  test("the panel's own picture wins: a partial row picture is not asked", () => {
    expect(keys(slide([null, pic("A fire hook")], { picture: pic("London burning") }))).toEqual([
      "panel",
    ]);
  });
});
