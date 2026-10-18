import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as P from "./bundles/base4f-p123/prompts.gen";
import { layoutsFor, PACK_SWITCH } from "./fixes";
import { offeredLayouts, packRepairMenu, packRepairSchema, pilotRequest } from "./pilot-pack";
import type { ChatReq } from "./services";
import { runWriter } from "./stage";

/*
 * Ruling 218's code half (TEACH-110 part t): a slide's fit repair in a run on the pilot pack is
 * offered only the layouts that pack offers, from the pack's own menu lines and schema, never
 * base4f-p123's repair menu (which still offers the retired compare). The run is a replay with a
 * stubbed chat that records the repair request; nothing is paid for.
 */

type S = Record<string, unknown>;
const dir = join(import.meta.dir, "fixtures/replay/y8-french-my-family");
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const long = (n: number) =>
  Array.from({ length: n }, (_, k) => `Ceci est la phrase numéro ${k + 1} qui est longue.`).join(
    " ",
  );

/**
 * The y8 replay written on the pilot pack: its slide 6 (a compare, written before v4.7) is an
 * explain far over its room instead. Its visual-text slide goes to the fit repair.
 */
async function repairCalls(): Promise<ChatReq[]> {
  const w = JSON.parse(read("main.json").text);
  w.slides[5] = {
    template: "explain",
    fit: "points-2",
    heading: "La famille",
    lead: long(12),
    points: [long(10), long(10)],
  };
  const calls: ChatReq[] = [];
  await runWriter({
    brief: read("brief.json"),
    objectives: read("objectives.json").objectives.map((o: { teacher: string }) => o.teacher),
    pilotPack: "v4.7",
    services: {
      log: () => {},
      writer: () => Promise.reject(new Error("no writer")),
      chat: async (r: ChatReq) => {
        calls.push(r);
        // No fix: the slide comes back as it was (the request is what is under test).
        throw new Error("no paid call");
      },
    },
    visual: () => ({ status: "failed" }),
    recordedWriter: { text: JSON.stringify(w), finishReason: "stop" },
    drawDiagrams: {
      callDrawer: async () => {
        throw new Error("no drawer");
      },
    },
  });
  // The fit repair (repair.txt), not a pilot slide's own-layout repair (one branch).
  return calls.filter(
    (c) =>
      c.name === "slide" &&
      c.system.startsWith("You fix one slide") &&
      ((c.schema as { properties: { slide: { anyOf: unknown[] } } }).properties.slide.anyOf
        .length ?? 0) > 1,
  );
}

/** The layouts a repair schema lets the slide become (`template` of every `slide` branch). */
const offered = (schema: S): string[] => {
  const defs = (schema.$defs ?? {}) as Record<string, S>;
  const refs = ((schema.properties as S).slide as { anyOf: { $ref: string }[] }).anyOf;
  return [
    ...new Set(
      refs.flatMap((r) => {
        const d = defs[r.$ref.replace("#/$defs/", "")] as
          | { properties?: { template?: { enum?: string[] } } }
          | undefined;
        return d?.properties?.template?.enum ?? [];
      }),
    ),
  ];
};

/** Where a schema breaks strict mode: an object that stays open or leaves a field optional. */
function strictFaults(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((x, k) => strictFaults(x, `${path}.${k}`));
  if (!node || typeof node !== "object") return [];
  const n = node as S;
  const out: string[] = [];
  if (n.type === "object" && n.properties) {
    if (n.additionalProperties !== false) out.push(`${path}: open`);
    const keys = Object.keys(n.properties as S).sort();
    if (JSON.stringify([...((n.required as string[]) ?? [])].sort()) !== JSON.stringify(keys))
      out.push(`${path}: optional fields`);
  }
  for (const [k, v] of Object.entries(n)) out.push(...strictFaults(v, `${path}.${k}`));
  return out;
}

describe("the fit repair offers only what the pilot pack offers (ruling 218)", () => {
  test("an over-full explain is repaired against v4.7's menu and schema: no compare", async () => {
    const calls = await repairCalls();
    // Reachable in a production-shaped run: the slide went to the fit repair.
    expect(calls.length).toBeGreaterThan(0);
    const retired = (await import("./pilot-pack")).PILOT_PACKS["v4.7"].layouts.retired;
    for (const c of calls) {
      const layouts = offered(c.schema as S);
      expect(layouts).toContain("visual-text");
      expect(layouts).not.toContain("compare");
      expect(layouts).not.toContain("cards-grid");
      for (const r of retired) expect(layouts).not.toContain(r);
      // The menu the repair reads is the pack's: its Fits lines are in words, as the writer's are.
      expect(c.user).not.toMatch(/^- compare:/m);
      expect(c.user).toMatch(/^- visual-text: .*Fits: points-0-fig \d+;/m);
      expect(c.user).not.toContain("characters, 503 in all");
      // Strict structured output: the call asks for it, and every object closes and requires
      // all its fields (what a strict decoder accepts).
      expect(c.strict).toBe(true);
      expect(strictFaults(c.schema)).toEqual([]);
      // Bounded. The pack's layouts carry the writer's typed diagram defs (each kind, side and
      // full), so a visual-text repair measures about 45k characters against base4f-p123's 11k
      // (one freeform diagram def): a fence against growth, not against that.
      const size = JSON.stringify(c.schema).length;
      expect(size).toBeGreaterThan(P.repairSchemaKS3_5.length);
      expect(size).toBeLessThanOrEqual(60_000);
      // The schema offers exactly the layouts the menu shows: the slide's own and its switches.
      const own = /\{"template":"([a-z-]+)"/.exec(c.user)?.[1] ?? "";
      expect(own).toBe("visual-text");
      const menu = (c.user.match(/^- ([a-z-]+): /gm) ?? []).map((l) => l.slice(2, -2));
      expect(menu.sort()).toEqual([own, ...(PACK_SWITCH[own] ?? [])].sort());
      expect([...layouts].sort()).toEqual(menu);
    }
  });
});

describe("the pack's repair menu and schema", () => {
  const prod = { properties: {}, $defs: {} };
  const req = pilotRequest("v4.7", "KS2", prod, (x) => x);
  const repair = {
    type: "object",
    properties: { fix: { type: "string" }, slide: {}, to_notes: { type: "string" } },
    $defs: { compare: { properties: { template: { enum: ["compare"] } } } },
  };
  test("a picture sequence's repair may become split-compare, and never compare", () => {
    const menu = layoutsFor(
      packRepairMenu(req.system, offeredLayouts(req.schema)),
      "picture-sequence",
      true,
    );
    expect(menu.split("\n")[0]).toStartWith("Layouts. ");
    expect(menu).toMatch(/^- split-compare: /m);
    expect(menu).toMatch(/^- picture-sequence: /m);
    expect(menu).not.toMatch(/^- compare: /m);
  });
  test("the schema keeps the writer's fits and drops a layout the writer is not offered", () => {
    const sc = packRepairSchema(repair, req.schema, ["explain", "compare", "split-compare"]);
    const refs = (sc.properties.slide.anyOf as { $ref: string }[]).map((r) => r.$ref.slice(8));
    expect(refs).toContain("split-compare");
    expect(refs.some((r) => r.startsWith("explain~"))).toBe(true);
    expect(refs.some((r) => r.startsWith("compare"))).toBe(false);
    expect(Object.keys(sc.$defs)).not.toContain("compare");
  });
});
