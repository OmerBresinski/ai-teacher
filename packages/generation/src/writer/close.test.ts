import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLOSING_DEF,
  closedSlides,
  hasExitLayout,
  NO_EXIT_LAYOUT,
  withClose,
  withCloseLine,
} from "./close";
import { PILOT_PACK_ID, PILOT_PACKS, type PilotPackId, pilotRequest } from "./pilot-pack";
import { replayRun } from "./replay-fixture";
import { runWriter, WriterIncompleteError } from "./stage";

/*
 * TEACH-110 part ab: every lesson ends with its check. The writer's schema makes the last slide
 * its own required field, `close` (the exit ticket, or the closing slide when the worksheet holds
 * it), and a writer output whose exit ticket belongs on the slides and has none is rejected before
 * anything is laid or stored.
 */

// biome-ignore lint/suspicious/noExplicitAny: walking a JSON schema
type J = Record<string, any>;
const names = (refs: J[]) => refs.map((r) => String(r.$ref).split("/").pop());
const isExit = (n: string | undefined) => String(n).split("~")[0] === "exit-ticket";

describe("withClose: the last slide is a required field", () => {
  for (const ks of ["KS1", "KS2", "KS3"] as const) {
    test(`${ks}, exit ticket on the slides: close takes only the exit ticket, slides never`, () => {
      const base = pilotRequest(PILOT_PACK_ID, ks, {}, (sc) => sc).schema as J;
      const s = withClose(base, true) as J;
      expect(s.required).toEqual(Object.keys(s.properties));
      const keys = Object.keys(s.properties);
      expect(keys.indexOf("close")).toBe(keys.indexOf("slides") + 1);
      const close = names(s.properties.close.anyOf);
      expect(close.length).toBeGreaterThan(0);
      expect(close.every(isExit)).toBe(true);
      expect(names(s.properties.slides.items.anyOf).some(isExit)).toBe(false);
      for (const n of close) expect(s.$defs[n as string]).toBeDefined();
      // the input is not changed
      expect(names(base.properties.slides.items.anyOf).some(isExit)).toBe(true);
    });
    test(`${ks}, exit ticket on the worksheet: close is the closing slide, no exit ticket anywhere`, () => {
      const s = withClose(pilotRequest(PILOT_PACK_ID, ks, {}, (sc) => sc).schema as J, false) as J;
      expect(names(s.properties.close.anyOf)).toEqual([CLOSING_DEF]);
      expect(s.properties.close.description).toContain("worksheet");
      const def = s.$defs[CLOSING_DEF];
      expect(def.properties.template.enum).toEqual(["discussion"]);
      expect(def.properties.picture).toEqual({ type: "null" });
      expect(def.required).toEqual(Object.keys(def.properties));
      expect(names(s.properties.slides.items.anyOf).some(isExit)).toBe(false);
    });
  }
  test("slides gives up one place to close, so the lesson's length is unchanged", () => {
    const schema: J = {
      type: "object",
      properties: {
        flow: { type: "array", minItems: 9, maxItems: 12 },
        slides: {
          type: "array",
          minItems: 7,
          maxItems: 10,
          items: { anyOf: [{ $ref: "#/$defs/hinge" }, { $ref: "#/$defs/exit-ticket" }] },
        },
      },
      $defs: { hinge: {}, "exit-ticket": {} },
    };
    const s = withClose(schema, true) as J;
    expect([s.properties.slides.minItems, s.properties.slides.maxItems]).toEqual([6, 9]);
    expect([s.properties.flow.minItems, s.properties.flow.maxItems]).toEqual([9, 12]);
  });
  test("a schema with no exit-ticket layout cannot close the lesson: it throws", () => {
    const schema: J = {
      properties: { slides: { items: { anyOf: [{ $ref: "#/$defs/hinge" }] } } },
      $defs: { hinge: {} },
    };
    expect(hasExitLayout(schema)).toBe(false);
    expect(() => withClose(schema, true)).toThrow(NO_EXIT_LAYOUT);
  });
  test("every pack in the repo offers an exit ticket, so none skips the requirement", () => {
    for (const id of Object.keys(PILOT_PACKS) as PilotPackId[])
      for (const ks of ["KS1", "KS2", "KS3"])
        expect(hasExitLayout(pilotRequest(id, ks, {}, (sc) => sc).schema as J), `${id} ${ks}`).toBe(
          true,
        );
  });
});

describe("closedSlides: close goes back at the end, and the guard", () => {
  const teach = [{ template: "hook" }, { template: "practice" }];
  test("exit ticket on the slides, written in close: last slide, no fault", () => {
    const r = closedSlides({ slides: teach, close: { template: "exit-ticket" } }, true);
    expect(r.slides.map((s) => s.template)).toEqual(["hook", "practice", "exit-ticket"]);
    expect(r.missing).toBeUndefined();
  });
  test("exit ticket on the slides and on none of them: rejected", () => {
    expect(closedSlides({ slides: teach }, true).missing).toMatch(/no exit ticket/);
    expect(closedSlides({ slides: teach, close: null }, true).missing).toMatch(/no exit ticket/);
  });
  test("exit ticket on the worksheet: the closing slide ends the deck", () => {
    const close = { template: "discussion", heading: "Exit ticket", lead: "Do it on your sheet." };
    const r = closedSlides({ slides: teach, close }, false);
    expect(r.slides.at(-1)).toEqual(close);
    expect(r).not.toHaveProperty("missing");
    expect(r).not.toHaveProperty("note");
  });
  test("a worksheet lesson from before close ships as written, noted", () => {
    const r = closedSlides({ slides: teach }, false);
    expect(r.slides).toEqual(teach);
    expect(r.missing).toBeUndefined();
    expect(r.note).toMatch(/no closing slide/);
  });
});

describe("runWriter: a writer output without its exit ticket is never laid or stored", () => {
  const dir = join(import.meta.dir, "fixtures/replay/y11-chemistry-rates-of-reaction");
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const text = (read("main.json") as { text: string }).text;
  test("the saved output ends on practice; with the exit ticket on the slides it throws", async () => {
    expect(
      (JSON.parse(text) as { slides: J[] }).slides.some((s) => s.template === "exit-ticket"),
    ).toBe(false);
    const events: J[] = [];
    let editable = false;
    const error = await runWriter({
      brief: { ...read("brief.json"), exitTicketOnSlides: true },
      objectives: (read("objectives.json") as { objectives: { teacher: string }[] }).objectives.map(
        (o) => o.teacher,
      ),
      pupilWording: false,
      services: {
        log: (e: J) => events.push(e),
        chat: () => Promise.reject(new Error("no call expected")),
        writer: async () => ({ text, finishReason: "stop", usd: 0, ms: 0 }),
      },
      onEditable: () => {
        editable = true;
      },
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(WriterIncompleteError);
    expect(String((error as Error).message)).toContain("no exit ticket");
    expect((error as WriterIncompleteError).deterministic).toBe(false);
    expect(editable).toBe(false);
    expect(events.some((e) => e.ev === "exit-ticket-missing")).toBe(true);
  });
});

describe("withCloseLine: the context names close", () => {
  const user = "Topic: Plants\nExit ticket: on the last slide\n\nObjectives:\n1. Name parts\n";
  test("on the slides: the line follows the exit-ticket line", () => {
    const lines = withCloseLine(user, true).split("\n");
    expect(lines[2]).toBe("Close (the last slide, after slides): the exit ticket.");
    expect(lines.filter((l) => l.startsWith("Close"))).toHaveLength(1);
  });
  test("on the worksheet: close sends the class to the worksheet", () => {
    expect(withCloseLine(user, false).split("\n")[2]).toContain("on their worksheet");
  });
  test("a context with no exit-ticket line gets it at the end", () => {
    expect(withCloseLine("Topic: Plants\n", true)).toBe(
      "Topic: Plants\nClose (the last slide, after slides): the exit ticket.\n",
    );
  });
});

describe("live writing: close is drafted and opened like any slide (draft mode)", async () => {
  type El = { id: string; children?: El[] };
  const flat = (els: El[]): El[] => els.flatMap((e) => [e, ...flat(e.children ?? [])]);
  const pieces = (text: string) => {
    const out: string[] = [];
    for (let at = 0; at < text.length; at += 7) out.push(text.slice(at, at + 7));
    return out;
  };
  const CLOSE = {
    template: "discussion",
    heading: "Exit ticket",
    lead: "Complete the exit ticket on your worksheet now.",
    picture: null,
  };
  // The saved run (worksheet setting) with its last slide written as `close`.
  const asClose = (text: string) => {
    const out = JSON.parse(text) as { slides: J[] };
    out.slides.pop();
    return JSON.stringify({ ...out, close: CLOSE });
  };
  const drafts = new Map<number, El[][]>();
  const events: string[] = [];
  const run = await replayRun("y5-maths-fractions-of-amounts", {
    stream: pieces,
    text: asClose,
    visual: () => ({ status: "pending" }),
    onStreamEnd: () => events.push("stream-end"),
    hooks: {
      draft: { ms: 0 },
      onDraftSlide: (i, s) => {
        events.push(`draft:${i}`);
        drafts.set(i, [...(drafts.get(i) ?? []), s.elements as unknown as El[]]);
      },
      onSlide: (i) => {
        events.push(`slide:${i}`);
      },
    },
  });
  // The closing slide's deck index: the slide after the last of `slides` (title 0, objectives 1).
  // Its plan index from its id: a fit continuation (UX-C J8) can sit before it in the deck.
  const shownAt = run.slides.findIndex((s) => JSON.stringify(s).includes(CLOSE.lead));
  const i = Number(run.slides[shownAt]?.id.slice(1)) - 1;

  test("the closing slide is the deck's last written slide", () => {
    const last = run.slides.filter((s) => !(s as { answersRole?: unknown }).answersRole).at(-1);
    expect(JSON.stringify(last)).toContain(CLOSE.lead);
  });
  test("its draft comes before the stream ends, and the slide opens before it ends", () => {
    expect(i).toBeGreaterThan(2);
    expect(Math.max(...drafts.keys())).toBe(i);
    const end = events.indexOf("stream-end");
    expect(events.indexOf(`draft:${i}`)).toBeGreaterThan(-1);
    expect(events.indexOf(`draft:${i}`)).toBeLessThan(end);
    expect(events.indexOf(`slide:${i}`)).toBeLessThan(end);
  });
  test("its draft ids carry its own prefix and survive the hand-over", () => {
    const last = (drafts.get(i) ?? []).at(-1) ?? [];
    for (const e of flat(last)) expect(e.id).toStartWith(`d-s${i + 1}-`);
    const shown = run.slides[shownAt] as unknown as { elements: El[] };
    const ids = new Set(flat(shown.elements).map((e) => e.id));
    expect(flat(last).filter((e) => ids.has(e.id)).length).toBeGreaterThan(0);
  });
});
