import { describe, expect, test } from "bun:test";
import type { FakeCall } from "@tj/ai/testing";
import { labAi, romansLesson } from "../planner/testing";
import { initialState, recordingDeps, writerFixture } from "../testing";
import { WRITER_VERSION, writerRoute } from "../writer/ai-services";
import { LAYOUT_WRITER_MENUS } from "../writer/layout-menu";
import { ITEMS_ROW_LABELLED, ITEMS_ROW_V417, PILOT_PACK_ID } from "../writer/pilot-pack";
import { checkedWriterObjectives } from "./objectives";
import { write } from "./write";

/*
 * TEACH-110 part s: production's write stage (write.ts -> runWriter) sends the pilot pack, its
 * system text assembled from the layout menus and its schema offering the pilot layouts, with the
 * retired ones gone. A stubbed model records the request; nothing is paid for.
 */

const fixture = writerFixture();
const answers = (call: FakeCall) => {
  const v = call.context?.promptVersion ?? "";
  if (!v.startsWith(`${WRITER_VERSION}/`)) return undefined;
  if (v.endsWith("/lesson")) return fixture.main;
  if (v.endsWith("/notes")) return fixture.notes;
  if (v.endsWith("/objectives"))
    return JSON.stringify({
      objectives: [
        "Describe who invaded Britain in AD 43.",
        "Explain why the Romans invaded Britain.",
        "Evaluate how far the invasion changed Britain.",
      ],
    });
  if (v.endsWith("/pupil_objectives")) return JSON.stringify({ pupil: ["a", "b", "c"] });
  return "{}";
};

describe("the production writer runs the pilot pack", () => {
  test("write sends the pack's system text and schema, and stamps the pack", async () => {
    const ai = labAi({ extra: answers, route: writerRoute });
    const planned = await checkedWriterObjectives(
      initialState(romansLesson()),
      recordingDeps(labAi({ extra: answers, route: writerRoute })),
    );
    const deps = recordingDeps(ai);
    const out = await write(planned, deps);
    const call = ai.calls.find((c) => c.context?.promptVersion?.endsWith("/lesson"));
    expect(call).toBeDefined();
    const system = call?.systemText ?? "";
    const stage = romansLesson().ageBand === "ks2" ? "KS2" : "KS3-5";
    // v4.17 reroutes items-row's long list of parts (no labelled diagram on the writer's menu).
    for (const menu of Object.values(LAYOUT_WRITER_MENUS))
      expect(system).toContain(menu[stage].replace(ITEMS_ROW_LABELLED, ITEMS_ROW_V417));
    const schema = (call?.responseFormat as { schema?: { $defs?: Record<string, unknown> } })
      ?.schema;
    const defs = Object.keys(schema?.$defs ?? {});
    for (const k of ["items-row", "panel-list", "split-compare"]) expect(defs).toContain(k);
    expect(defs.some((k) => k.startsWith("compare~") || k.startsWith("cards-grid"))).toBe(false);
    expect(out.lesson.generation?.promptVersions.generated).toContain(`+pilot-${PILOT_PACK_ID}`);
  });
});
