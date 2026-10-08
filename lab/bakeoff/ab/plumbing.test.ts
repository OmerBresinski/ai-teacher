// Measurement plumbing (audit rootcause/checking-audit.json "pipeline" F4-F9, 8 Oct).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { sentShas } from "../harness";
import { ENGLAND, INDIA, localise } from "../locale";
import { decodePng, isBlankPng } from "../pngblank";
import { Ledger } from "../services";
import { codeOnlyFault, HEAD_ONLY, HEAD_SHARED, pinOf, SHARED_PINNED, sharedReads } from "./arms";
import { lessonDone, moveToCrashed } from "./done";

const h = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const ROOT = `${import.meta.dir}/cache/plumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("F4 cost.json total", () => {
  test("an incomplete writer's total includes picture spend made while streaming", () => {
    const l = new Ledger(1);
    l.add("pictures", 0.015925);
    l.add("main", 0.0912091);
    const c = l.costJson({ note: "writer output incomplete" });
    expect(c.total).toBeCloseTo(0.1071341, 7);
    expect(c).toMatchObject({
      pictures: 0.015925,
      main: 0.0912091,
      note: "writer output incomplete",
    });
  });
  test("the picture director's outside spend is booked and counted", () => {
    const l = new Ledger(1);
    l.add("main", 0.05);
    l.outside = () => 0.02;
    expect(l.costJson()).toMatchObject({ main: 0.05, picturesDirector: 0.02, total: 0.07 });
  });
  test("harness.ts writes every early cost.json through costJson (no total: main.usd)", () => {
    const src = readFileSync(`${import.meta.dir}/../harness.ts`, "utf8");
    expect(src).not.toContain("total: main.usd");
    expect(src.match(/ledger\.costJson\(/g)?.length).toBe(4);
  });
});

/** A minimal 8-bit RGBA PNG (one filter type for every row) for the decoder tests. */
function png(w: number, hgt: number, px: (x: number, y: number) => number[], filter = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t, "latin1"), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(hgt, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw: number[] = [];
  const rows: number[][] = [];
  for (let y = 0; y < hgt; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) row.push(...px(x, y));
    rows.push(row);
    raw.push(filter);
    for (let i = 0; i < row.length; i++) {
      const up = y ? ((rows[y - 1] as number[])[i] as number) : 0;
      raw.push(filter === 2 ? ((row[i] as number) - up) & 0xff : (row[i] as number));
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from(raw))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

describe("F5 blank-render guard reads the saved PNG", () => {
  const W = 360;
  const H = 202;
  test("a pure white frame is blank; a frame with a heading's worth of ink is not", () => {
    expect(isBlankPng(png(W, H, () => [255, 255, 255, 255]))).toBe(true);
    const heading = (x: number, y: number) =>
      y >= 20 && y < 34 && x >= 30 && x < 200 && (x + y) % 3 === 0
        ? [20, 20, 40, 255]
        : [255, 255, 255, 255];
    expect(isBlankPng(png(W, H, heading))).toBe(false);
    expect(isBlankPng(png(W, H, heading, 2))).toBe(false);
  });
  test("a coloured but uniform frame is blank too (blank is near-uniform, not only white)", () => {
    expect(isBlankPng(png(W, H, () => [240, 236, 228, 255]))).toBe(true);
  });
  test("decoder reads Up-filtered rows exactly", () => {
    const p = decodePng(png(4, 3, (x, y) => [x * 10, y * 20, 7, 255], 2));
    expect([...p.data.slice(4 * 4 * 2, 4 * 4 * 2 + 4)]).toEqual([0, 40, 7, 255]);
  });
  test("a real saved slide render is not blank", () => {
    const runs =
      "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/rounds/BAKEOFF/ab/runs";
    const find = (d: string, depth: number): string | undefined => {
      if (!existsSync(d) || depth > 4) return undefined;
      for (const f of readdirSync(d).sort()) {
        if (f === "slide-03.png") return `${d}/${f}`;
        const p = `${d}/${f}`;
        if (!f.includes(".")) {
          const r = find(p, depth + 1);
          if (r) return r;
        }
      }
      return undefined;
    };
    const f = find(runs, 0);
    if (!f) return; // no renders on this machine
    expect(isBlankPng(f)).toBe(false);
  });
  test("render.ts checks the saved PNG and never innerText", () => {
    const src = readFileSync(`${import.meta.dir}/../render.ts`, "utf8");
    expect(src).toContain("isBlankPng(png)");
    expect(src).not.toContain("innerText.includes(w)");
  });
});

describe("F6 unfinished lesson dirs", () => {
  test("only a dir whose log has a summary event is finished; an unfinished one moves to crashed/", () => {
    const runs = `${ROOT}/runs`;
    const done = `${runs}/T/y1`;
    const stub = `${runs}/T/y5`;
    for (const d of [done, stub]) mkdirSync(d, { recursive: true });
    writeFileSync(`${done}/lesson.json`, "{}");
    writeFileSync(`${done}/log.jsonl`, '{"ev":"start"}\n{"ev":"summary","slides":12}\n');
    writeFileSync(`${stub}/lesson.json`, '{"slides":[{}]}');
    writeFileSync(`${stub}/log.jsonl`, '{"ev":"start"}\n{"ev":"cache","note":"summary"}\n');
    expect(lessonDone(done)).toBe(true);
    expect(lessonDone(stub)).toBe(false);
    expect(lessonDone(`${runs}/T/none`)).toBe(false);
    expect(moveToCrashed(stub)).toBe(`${runs}/crashed/y5`);
    mkdirSync(stub);
    expect(moveToCrashed(stub)).toBe(`${runs}/crashed/y5.2`);
    expect(existsSync(`${runs}/crashed/y5/lesson.json`)).toBe(true);
    expect(readdirSync(`${runs}/T`)).toEqual(["y1"]);
  });
  test("run.ts skips only finished lessons", () => {
    const src = readFileSync(`${import.meta.dir}/../run.ts`, "utf8");
    expect(src).toContain("if (lessonDone(outDir))");
    expect(src).not.toContain("existsSync(`${outDir}/lesson.json`)");
  });
});

describe("F7 request.json records what was sent", () => {
  test("sent shas hash the localised text, with the locale", () => {
    const sys = "Teach pupils in {{locale.country}}.{{locale.setting}}";
    const user = "A {{locale.yearWord}} 5 lesson.";
    const india = sentShas(sys, user, INDIA);
    expect(india.sentSystemSha).toBe(h(localise(sys, INDIA)));
    expect(india.sentSystemSha).not.toBe(h(sys));
    expect(india.sentUserSha).toBe(h("A Class 5 lesson."));
    expect(india.locale.country).toBe("India");
    expect(sentShas(sys, user, ENGLAND).sentSystemSha).toBe(h("Teach pupils in England."));
  });
  test("harness.ts writes the sent shas and the code arm into request.json", () => {
    const src = readFileSync(`${import.meta.dir}/../harness.ts`, "utf8");
    expect(src).toContain("...sentShas(p.system, user)");
    expect(src).toContain("codeArm: abCodeArm()");
  });
});

describe("F8 pins cover every shared prompt a run reads", () => {
  test("head-only files are read and pinned from the head folder, for every arm", () => {
    for (const arm of ["base4", "base5", "polish2"] as const) {
      const r = sharedReads(arm);
      for (const f of HEAD_ONLY)
        expect(r).toContainEqual({
          key: `head:prompts/${f}`,
          path: `${HEAD_SHARED}/${f.slice(7)}`,
        });
      // Every SHARED_PINNED file is covered, from the arm's copy or the head.
      for (const f of SHARED_PINNED) expect(r.some((x) => x.path.endsWith(`/${f}`))).toBe(true);
    }
  });
  test("a pin is the file's sha, or absent", () => {
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(`${ROOT}/p.txt`, "x");
    expect(pinOf(`${ROOT}/p.txt`)).toBe(h("x"));
    expect(pinOf(`${ROOT}/missing.txt`)).toBe("absent");
  });
  test("picture director v12 and judge v20 prompt code is pinned", async () => {
    const { CODE_PINNED } = await import("./arms");
    expect(CODE_PINNED).toContain("packages/generation/src/prompts/picture-director-v12.ts");
    expect(CODE_PINNED).toContain("packages/generation/src/prompts/pick-or-requery-photo-v20.ts");
  });
});

describe("F9 check.ts labels", () => {
  test("each code-only arm's failure names that arm", () => {
    expect(codeOnlyFault("dir-stage", "y1", true)).toStartWith("dir-stage y1:");
    expect(codeOnlyFault("judge20", "y1", true)).toStartWith("judge20 y1:");
    expect(codeOnlyFault("y1fix", "y5", true)).toStartWith("y1fix y5:");
    expect(codeOnlyFault("b4-r1t3", "y5", true)).toStartWith("b4-r1t3 y5:");
    expect(codeOnlyFault("b4-r1t2", "y5", true)).toStartWith("b4-r1t2 y5:");
    expect(codeOnlyFault("y1fix", "y5", false)).toBeUndefined();
    expect(codeOnlyFault("base4", "y5", true)).toBeUndefined();
  });
  test("the base ok line is not suppressed by another arm's failure", () => {
    const src = readFileSync(`${import.meta.dir}/check.ts`, "utf8");
    expect(src).not.toContain("if (!bad) ok(");
    expect(src).toContain("if (bad === failsBefore) ok(`base ${id}");
  });
});
