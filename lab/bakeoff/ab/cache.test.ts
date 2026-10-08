// A/B response cache (ab/cache.ts, ab/CACHE.md): exact keys only, replay in call order, $0 hits.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chat, chatStream } from "../services";
import {
  canonical,
  createCache,
  loadRun,
  requestForm,
  requestKey,
  usageOf,
  zeroUsage,
} from "./cache";
import { jsonOf, legacyImporter, sseOf } from "./cache-import";

const ROOT = `${import.meta.dir}/cache/test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const dirs = () => {
  const d = `${ROOT}/${++seq}`;
  mkdirSync(d, { recursive: true });
  return { runDir: `${d}/run`, storeDir: `${d}/store` };
};
const OPENAI = "https://api.openai.com/v1/chat/completions";
const reqBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ model: "gpt-6-luna", messages: [{ role: "user", content: "hi" }], ...over });
/** A fake API: answers each call with a new numbered body and counts calls. */
function fakeApi(contentType = "application/json") {
  const calls: string[] = [];
  const f = (async (_u: unknown, init?: RequestInit) => {
    calls.push(String(init?.body));
    const n = calls.length;
    const text =
      contentType === "text/event-stream"
        ? `data: {"choices":[{"delta":{"content":"{\\"n\\":${n}}"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":100}}\n\ndata: [DONE]\n\n`
        : JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ n }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 },
          });
    return new Response(text, { status: 200, headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const price = () => 0.01;
const post = (body: string) => ({ method: "POST", body });

describe("keys", () => {
  test("sorted keys: the same object in another order has the same key; any parameter changes it", async () => {
    const k = async (b: string) => requestKey(await requestForm(OPENAI, post(b), new Map()));
    const a = await k(reqBody({ reasoning_effort: "low" }));
    const b = await k(
      JSON.stringify({
        reasoning_effort: "low",
        messages: [{ content: "hi", role: "user" }],
        model: "gpt-6-luna",
      }),
    );
    expect(a).toBe(b);
    expect(await k(reqBody({ reasoning_effort: "medium" }))).not.toBe(a);
    expect(await k(reqBody({ model: "gpt-6.1-sol", reasoning_effort: "low" }))).not.toBe(a);
    expect(
      await k(reqBody({ reasoning_effort: "low", messages: [{ role: "user", content: "hi " }] })),
    ).not.toBe(a);
  });
  test("images are keyed by their own hash", () => {
    const img = (c: string) => `data:image/png;base64,${c.repeat(400)}`;
    const blobs = new Map<string, Uint8Array>();
    const x = JSON.stringify(canonical({ url: img("A") }, blobs));
    expect(x).toMatch(/sha256:[0-9a-f]{64}/);
    expect(blobs.size).toBe(1);
    expect(JSON.stringify(canonical({ url: img("B") }))).not.toBe(x);
    expect(JSON.stringify(canonical({ url: img("A") }))).toBe(x);
  });
  test("an uploaded file (image edit) is keyed by its bytes", async () => {
    const form = (b: string) => {
      const f = new FormData();
      f.set("prompt", "a hen");
      f.set("image", new Blob([b], { type: "image/png" }), "a.png");
      return f;
    };
    const k = async (b: string) =>
      requestKey(
        await requestForm(
          "https://api.openai.com/v1/images/edits",
          { method: "POST", body: form(b) },
          new Map(),
        ),
      );
    expect(await k("one")).toBe(await k("one"));
    expect(await k("one")).not.toBe(await k("two"));
  });
});

describe("usage", () => {
  test("JSON and SSE usage zeroed; read back", () => {
    const j = JSON.stringify({
      usage: { prompt_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } },
      x: 1,
    });
    expect(JSON.parse(zeroUsage(j, "application/json"))).toEqual({
      usage: { prompt_tokens: 0, completion_tokens_details: { reasoning_tokens: 0 } },
      x: 1,
    });
    const s =
      'data: {"choices":[]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":7}}\n\ndata: [DONE]\n\n';
    expect(usageOf(s, "text/event-stream")).toEqual({ prompt_tokens: 7 });
    expect(usageOf(zeroUsage(s, "text/event-stream"), "text/event-stream")).toEqual({
      prompt_tokens: 0,
    });
  });
});

describe("record and replay", () => {
  test("a fresh run records every call; its replay serves them in order at $0 with no API call", async () => {
    const d = dirs();
    const api = fakeApi();
    const first = createCache({ ...d, price }, api.f);
    const bodies: string[] = [];
    for (const b of [reqBody(), reqBody(), reqBody({ n: 2 })])
      bodies.push(await (await first.fetch(OPENAI, post(b))).text());
    await first.drain();
    expect(api.calls.length).toBe(3);
    expect(first.stats.made).toBe(3);
    expect(first.stats.spentUsd).toBeCloseTo(0.03);

    const replay = dirs();
    const api2 = fakeApi();
    const again = createCache(
      {
        ...replay,
        source: loadRun(d.runDir),
        sourceBlobs: [`${d.runDir}/calls/blobs`],
        offline: true,
        price,
      },
      api2.f,
    );
    const got: Response[] = [];
    for (const b of [reqBody(), reqBody(), reqBody({ n: 2 })])
      got.push(await again.fetch(OPENAI, post(b)));
    expect(api2.calls.length).toBe(0);
    const texts = await Promise.all(got.map((r) => r.text()));
    // The n-th call of a key gets the n-th recorded response (a retry of the same request is not collapsed).
    expect(texts.map((t) => JSON.parse(t).choices[0].message.content)).toEqual(
      bodies.map((t) => JSON.parse(t).choices[0].message.content),
    );
    expect(JSON.parse(texts[0] ?? "").usage).toEqual({ prompt_tokens: 0, completion_tokens: 0 });
    expect(got[0]?.headers.get("x-ab-cache")).toBe("hit");
    expect(JSON.parse(got[0]?.headers.get("x-ab-cache-usage") ?? "")).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 100,
    });
    expect(again.stats).toMatchObject({ cached: 3, made: 0, refused: 0 });
    expect(again.stats.savedUsd).toBeCloseTo(0.03);
    // The replay is itself replayable (its calls.jsonl holds every call).
    expect(loadRun(replay.runDir)?.size).toBe(2);
    expect(readFileSync(`${replay.runDir}/calls.jsonl`, "utf8")).toContain('"cached":true');
  });

  test("a changed request is never served a recorded response: it is called fresh, or refused offline", async () => {
    const d = dirs();
    const api = fakeApi();
    const rec = createCache({ ...d, price }, api.f);
    await (await rec.fetch(OPENAI, post(reqBody()))).text();
    await rec.drain();
    const api2 = fakeApi();
    const c = createCache(
      { ...dirs(), source: loadRun(d.runDir), sourceBlobs: [`${d.runDir}/calls/blobs`], price },
      api2.f,
    );
    await (await c.fetch(OPENAI, post(reqBody({ temperature: 0 })))).text();
    await c.drain();
    expect(api2.calls.length).toBe(1);
    expect(c.stats).toMatchObject({ made: 1, cached: 0 });
    // A third call of a key the replayed run made only once has no recorded response either.
    const off = createCache(
      {
        ...dirs(),
        source: loadRun(d.runDir),
        sourceBlobs: [`${d.runDir}/calls/blobs`],
        offline: true,
      },
      fakeApi().f,
    );
    await off.fetch(OPENAI, post(reqBody()));
    await expect(off.fetch(OPENAI, post(reqBody()))).rejects.toThrow(/offline/);
    expect(off.stats.refused).toBe(1);
  });

  test("no source: every call is fresh (the safe default), local hosts are never cached", async () => {
    const d = dirs();
    const api = fakeApi();
    const c = createCache({ ...d }, api.f);
    await (await c.fetch(OPENAI, post(reqBody()))).text();
    await (await c.fetch(OPENAI, post(reqBody()))).text();
    await (await c.fetch("http://localhost:4959/x", post("{}"))).text();
    await c.drain();
    expect(api.calls.length).toBe(3);
    expect(c.stats.made).toBe(2);
  });

  test("streams pass through as they arrive, are stored, and replay with zero usage", async () => {
    const d = dirs();
    const api = fakeApi("text/event-stream");
    const c = createCache({ ...d, price }, api.f);
    const t1 = await (await c.fetch(OPENAI, post(reqBody({ stream: true })))).text();
    await c.drain();
    const r = createCache(
      {
        ...dirs(),
        source: loadRun(d.runDir),
        sourceBlobs: [`${d.runDir}/calls/blobs`],
        offline: true,
      },
      fakeApi().f,
    );
    const t2 = await (await r.fetch(OPENAI, post(reqBody({ stream: true })))).text();
    expect(t2).toBe(zeroUsage(t1, "text/event-stream"));
    expect(t2).toContain('{\\"n\\":1}');
  });
});

describe("chat wrappers on a hit", () => {
  test("chat and chatStream return the original usage, $0, cached: true", async () => {
    const d = dirs();
    const api = fakeApi();
    const rec = createCache({ ...d, price }, api.f);
    const real = globalThis.fetch;
    try {
      globalThis.fetch = rec.fetch;
      const req = {
        model: "gpt-6-luna",
        effort: "low" as const,
        system: "s",
        user: "u",
        schema: {},
        name: "t",
      };
      const a = await chat(req);
      await rec.drain();
      expect(a.cached).toBeUndefined();
      expect(a.usd).toBeGreaterThan(0);
      const rep = createCache(
        {
          ...dirs(),
          source: loadRun(d.runDir),
          sourceBlobs: [`${d.runDir}/calls/blobs`],
          offline: true,
        },
        fakeApi().f,
      );
      globalThis.fetch = rep.fetch;
      const b = await chat(req);
      expect(b).toMatchObject({
        cached: true,
        usd: 0,
        out: a.out,
        usage: { prompt_tokens: 1000, completion_tokens: 100 },
      });

      const sd = dirs();
      const sapi = fakeApi("text/event-stream");
      const srec = createCache({ ...sd, price }, sapi.f);
      globalThis.fetch = srec.fetch;
      const s1 = await chatStream(req, () => {});
      await srec.drain();
      globalThis.fetch = createCache(
        {
          ...dirs(),
          source: loadRun(sd.runDir),
          sourceBlobs: [`${sd.runDir}/calls/blobs`],
          offline: true,
        },
        fakeApi().f,
      ).fetch;
      const s2 = await chatStream(req, () => {});
      expect(s2).toMatchObject({
        cached: true,
        usd: 0,
        text: s1.text,
        usage: { prompt_tokens: 1000 },
      });
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("legacy importer", () => {
  const lesson = () => {
    const d = `${dirs().runDir}-legacy`;
    mkdirSync(d, { recursive: true });
    const { createHash } = require("node:crypto");
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    const schema = { type: "object" };
    writeFileSync(
      `${d}/request.json`,
      JSON.stringify({
        model: "gpt-6.1-sol",
        effort: "low",
        user: "U",
        systemSha: h("SYS"),
        schemaSha: h(JSON.stringify(schema)),
      }),
    );
    writeFileSync(`${d}/stream.txt`, '{"slides":[]}');
    writeFileSync(`${d}/cost.json`, JSON.stringify({ main: 0.04, repair: 0.002 }));
    writeFileSync(
      `${d}/repair.jsonl`,
      `${JSON.stringify({ slide: 4, mode: "fit", input: { heading: "H" }, out: { fix: "x" } })}\n`,
    );
    return { d, schema };
  };
  const form = { method: "POST", url: OPENAI, body: null };
  test("the writer is imported only when model, effort, system sha, schema sha and user all match", () => {
    const { d, schema } = lesson();
    const meta = {
      name: "lesson",
      model: "gpt-6.1-sol",
      effort: "low",
      system: "SYS",
      user: "U",
      schema,
    };
    expect(legacyImporter(d)({ form, meta: { ...meta, system: "SYS2" } })).toBeUndefined();
    expect(legacyImporter(d)({ form, meta: { ...meta, user: "U2" } })).toBeUndefined();
    expect(legacyImporter(d)({ form, meta: { ...meta, effort: "medium" } })).toBeUndefined();
    const got = legacyImporter(d)({ form, meta });
    expect(got).toMatchObject({ verify: "exact-sha", usd: 0.04, text: sseOf('{"slides":[]}') });
  });
  test("a repair is imported only for the logged slide JSON", () => {
    const { d } = lesson();
    const imp = legacyImporter(d);
    expect(
      imp({ form, meta: { name: "slide", user: 'Slide 4: {"heading":"G"}' } }),
    ).toBeUndefined();
    expect(imp({ form, meta: { name: "slide", user: 'Slide 4: {"heading":"H"}' } })).toMatchObject({
      text: jsonOf('{"fix":"x"}'),
      verify: "slide-json",
    });
  });
});
