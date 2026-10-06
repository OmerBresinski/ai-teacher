import { describe, expect, test } from "bun:test";
import { OBJECTIVES_CONFIG, objectivesCall, pupilCall, type Streamer } from "./objectives";
import type { ChatReq } from "./services";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A fake streaming model: `delay` ms before the first chunk, then the JSON in small pieces; it honours abort. */
function fake(models: Record<string, { delay: number; json?: unknown; fail?: boolean }>) {
  const calls: string[] = [];
  const stream: Streamer = async (r: ChatReq, onText) => {
    calls.push(r.model);
    const m = models[r.model];
    if (!m) throw new Error(`no model ${r.model}`);
    const aborted = new Promise<never>((_, rej) =>
      r.signal?.addEventListener("abort", () => rej(r.signal?.reason ?? new Error("aborted")), {
        once: true,
      }),
    );
    await Promise.race([sleep(m.delay), aborted]);
    if (m.fail) throw new Error("socket closed");
    const text = JSON.stringify(m.json);
    for (let k = 0; k < text.length; k += 7) onText(text.slice(k, k + 7));
    return { text, usage: {}, usd: 0.001, ms: m.delay, firstTokenMs: m.delay };
  };
  return { stream, calls };
}
const req = { system: "s", user: "u", schema: {}, name: "objectives" };
const cfg = { ...OBJECTIVES_CONFIG, firstWithinMs: 60 };
const teacher = {
  objectives: ["Explain how rate depends on temperature.", "Calculate a mean rate."],
};

describe("objectives call: Sol with a Luna fallback", () => {
  test("the ship defaults are in code", () => {
    expect(OBJECTIVES_CONFIG.primary).toEqual({ model: "gpt-6.1-sol", effort: "low" });
    expect(OBJECTIVES_CONFIG.fallback).toEqual({ model: "gpt-6-luna", effort: "low" });
    expect(OBJECTIVES_CONFIG.firstWithinMs).toBe(8000);
  });
  test("a primary that streams in time is used", async () => {
    const f = fake({
      "gpt-6.1-sol": { delay: 10, json: teacher },
      "gpt-6-luna": { delay: 5, json: teacher },
    });
    const seen: string[] = [];
    const r = await objectivesCall(req, f.stream, (t) => seen.push(t), cfg);
    expect(r.ran).toBe("primary");
    expect(r.teacher).toEqual(teacher.objectives);
    expect(seen).toEqual(teacher.objectives);
    expect(f.calls).toEqual(["gpt-6.1-sol"]);
  });
  test("no first objective by the deadline: the primary is aborted and Luna runs", async () => {
    const f = fake({
      "gpt-6.1-sol": { delay: 500, json: teacher },
      "gpt-6-luna": { delay: 5, json: teacher },
    });
    const t0 = performance.now();
    const r = await objectivesCall(req, f.stream, () => {}, cfg);
    expect(r.ran).toBe("fallback");
    expect(r.model).toBe("gpt-6-luna");
    expect(r.abandoned?.reason).toContain("no objective within 60 ms");
    expect(r.teacher).toEqual(teacher.objectives);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(f.calls).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
  });
  test("a primary that fails early falls back too; older {teacher, pupil} items still parse", async () => {
    const old = { objectives: [{ teacher: "Describe a lamb.", pupil: "I can name a lamb." }] };
    const f = fake({
      "gpt-6.1-sol": { delay: 5, fail: true },
      "gpt-6-luna": { delay: 5, json: old },
    });
    const r = await objectivesCall(req, f.stream, () => {}, cfg);
    expect(r.ran).toBe("fallback");
    expect(r.teacher).toEqual(["Describe a lamb."]);
  });
});

describe("pupil wording call", () => {
  test("each pupil line arrives in order as it closes", async () => {
    const f = fake({
      "gpt-6-luna": {
        delay: 5,
        json: { pupil: ["I can explain rate.", "I can calculate a mean rate."] },
      },
    });
    const lines: [number, string][] = [];
    const r = await pupilCall({ ...req, name: "pupil" }, f.stream, (l, k) => lines.push([k, l]));
    expect(r.pupil.length).toBe(2);
    expect(lines).toEqual([
      [0, "I can explain rate."],
      [1, "I can calculate a mean rate."],
    ]);
    expect(f.calls).toEqual([OBJECTIVES_CONFIG.pupil.model]);
  });
});
