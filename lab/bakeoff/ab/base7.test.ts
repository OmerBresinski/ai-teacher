// base7 (arms3/base7/DIFF.md): the combined candidate's code switches, and the opener slot's two arms.
import { afterEach, describe, expect, test } from "bun:test";
import {
  AB_ARMS,
  AB_CONFIG,
  AB_REF,
  abExitTicket,
  abFigureSync,
  abGas8,
  abHookFirst,
  abLabels3,
  abMatch6,
  abOrphan6,
  abPlotZone,
  abSnugNodes,
  abStage6,
  abTitleSub,
  EXIT_TICKET_ARMS,
  hookFirstOrder,
  setAbArm,
  setAbCodeArm,
} from "./arms";

afterEach(() => {
  setAbArm(undefined);
  setAbCodeArm(undefined);
});

const SWITCHES = [
  "exitTicket",
  "labels3",
  "orphan6",
  "match6",
  "stage6",
  "gas8",
  "figureSync",
  "plotZone",
] as const;
const own = (a: string) => {
  const { delta: _d, ...c } = AB_CONFIG[a as keyof typeof AB_CONFIG] as Record<string, unknown>;
  return c;
};

describe("base7", () => {
  test("base7 = base6b + exactly the eight switches, nothing else", () => {
    const b7 = own("base7");
    const b6b = own("base6b");
    const extra = Object.fromEntries(SWITCHES.map((k) => [k, true]));
    expect(b7).toEqual({ ...b6b, ...extra });
    expect(b7.titleSub).toBeUndefined(); // base6b: titleSub off, so the writer's opener ships
  });
  test("each switch's own arm and base7 agree on the switch's value", () => {
    const src: Record<(typeof SWITCHES)[number], string> = {
      exitTicket: "exit1",
      labels3: "labels3",
      orphan6: "orphan6",
      match6: "match6",
      stage6: "stage6",
      gas8: "gas8",
      figureSync: "base6sync",
      plotZone: "plotzone",
    };
    for (const k of SWITCHES) expect(own(src[k])[k]).toBe(own("base7")[k]);
  });
  test("every accessor is on under base7, hookFirst off, titleSub off, snug nodes on", () => {
    setAbArm("base7");
    setAbCodeArm("base7");
    expect([
      abExitTicket(),
      abLabels3(),
      abOrphan6(),
      abMatch6(),
      abStage6(),
      abGas8(),
      abFigureSync(),
      abPlotZone(),
      abSnugNodes(),
    ]).toEqual(Array(9).fill(true));
    expect(abTitleSub()).toBe(false);
    expect(abHookFirst()).toBe(false);
  });
  test("opener slot: base7c = base7 + hookFirst; base7d = base7's code", () => {
    const { hookFirst, ...c } = own("base7c");
    expect(hookFirst).toBe(true);
    expect(c).toEqual(own("base7"));
    expect(own("base7d")).toEqual(own("base7"));
    for (const a of AB_ARMS) expect(Boolean(AB_CONFIG[a].hookFirst)).toBe(a === "base7c");
    setAbCodeArm("base7c");
    expect(abHookFirst()).toBe(true);
    setAbCodeArm("base7d");
    expect(abHookFirst()).toBe(false);
  });
  test("refs and the exit-ticket user turn", () => {
    expect(AB_REF.base7?.ref).toBe("exit1");
    expect(AB_REF.base7c?.ref).toBe("base7");
    expect(AB_REF.base7d?.ref).toBe("base7");
    for (const a of ["exit1", "base7", "base7c", "base7d"]) expect(EXIT_TICKET_ARMS).toContain(a);
  });
  test("hookFirstOrder keeps a code-placed exit ticket last", () => {
    const s = (...ids: string[]) => ids.map((id) => ({ id }));
    const ids = (x: { id: string }[]) => x.map((y) => y.id);
    expect(ids(hookFirstOrder(s("s1", "s2", "s3", "s4", "s5")))).toEqual([
      "s1",
      "s3",
      "s2",
      "s4",
      "s5",
    ]);
    expect(ids(hookFirstOrder(s("s1", "s2", "s3c1")))).toEqual(["s1", "s2", "s3c1"]);
  });
});
