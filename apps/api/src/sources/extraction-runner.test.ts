import { describe, expect, test } from "bun:test";
import { ExtractError, MIME } from "@tj/extract";
import { docxWith, pdfWithPages, plainZip, pptxBomb } from "@tj/extract/testing";
import {
  CHILD_RUNNER_DEFAULTS,
  ChildProcessExtractionRunner,
  childEntryFor,
  ExtractionBusyError,
  ExtractionFailedError,
  loadChildRunnerConfig,
} from "./extraction-runner";

const FAKE = new URL("./testing/fake-child.ts", import.meta.url).pathname;
const REAL = new URL("./extract-child.ts", import.meta.url).pathname;

const runner = (
  over: Partial<ConstructorParameters<typeof ChildProcessExtractionRunner>[0]> = {},
) =>
  new ChildProcessExtractionRunner({
    entry: FAKE,
    deadlineMs: 2_000,
    maxConcurrent: 1,
    maxQueue: 1,
    maxOutputBytes: 1024 * 1024,
    ...over,
  });

const input = { bytes: new TextEncoder().encode("hello"), mime: MIME.paste, name: "p" } as const;

describe("ChildProcessExtractionRunner (fake child)", () => {
  test("an answering child yields the decoded extraction; stdin carried the bytes", async () => {
    const out = await runner().run(input);
    expect(out.mime).toBe(MIME.paste);
    expect(out.extraction.chunks[0]?.text).toBe(`bytes:5 ${MIME.paste}`);
  });

  test("a hung child is killed at the deadline and the slot is reclaimed", async () => {
    const r = runner({ deadlineMs: 300, childEnv: { FAKE_CHILD_MODE: "hang" } });
    const started = Date.now();
    await expect(r.run(input)).rejects.toMatchObject({ why: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.load).toEqual({ running: 0, queued: 0 });
    // The next run gets the slot immediately.
    const ok = runner({ childEnv: { FAKE_CHILD_MODE: "echo" } });
    await expect(ok.run(input)).resolves.toBeDefined();
  });

  test("client abort kills the child before the deadline", async () => {
    const r = runner({ deadlineMs: 10_000, childEnv: { FAKE_CHILD_MODE: "hang" } });
    const controller = new AbortController();
    const pending = r.run(input, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    await expect(pending).rejects.toMatchObject({ why: "aborted" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.load.running).toBe(0);
  });

  test("an over-producing child is killed at the output cap", async () => {
    const r = runner({
      deadlineMs: 10_000,
      maxOutputBytes: 128 * 1024,
      childEnv: { FAKE_CHILD_MODE: "flood" },
    });
    await expect(r.run(input)).rejects.toMatchObject({ why: "output-too-large" });
  });

  test("a crash and a non-JSON answer are content-free failures", async () => {
    await expect(
      runner({ childEnv: { FAKE_CHILD_MODE: "crash" } }).run(input),
    ).rejects.toMatchObject({
      why: "crashed",
      exitCode: 3,
    });
    await expect(
      runner({ childEnv: { FAKE_CHILD_MODE: "garbage" } }).run(input),
    ).rejects.toMatchObject({
      why: "bad-answer",
    });
  });

  test.each(["bad-shape", "unsafe-error"])(
    "%s rejects without hanging or leaking a slot",
    async (mode) => {
      const r = runner({ childEnv: { FAKE_CHILD_MODE: mode } });
      await expect(r.run(input)).rejects.toMatchObject({ why: "bad-answer" });
      expect(r.load).toEqual({ running: 0, queued: 0 });
    },
  );

  test("valid output does not make a failed process successful", async () => {
    await expect(
      runner({ childEnv: { FAKE_CHILD_MODE: "answer-then-crash" } }).run(input),
    ).rejects.toMatchObject({ why: "crashed", exitCode: 3 });
  });

  test("abort immediately after acquiring the slot is observed", async () => {
    const r = runner({ childEnv: { FAKE_CHILD_MODE: "hang" } });
    const controller = new AbortController();
    const pending = r.run(input, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ why: "aborted" });
    expect(r.load).toEqual({ running: 0, queued: 0 });
  });

  test("concurrency: one slot + one queue position; the third upload is refused before spawning", async () => {
    const r = runner({
      deadlineMs: 5_000,
      maxConcurrent: 1,
      maxQueue: 1,
      childEnv: { FAKE_CHILD_MODE: "hang" },
    });
    const first = r.run(input).catch((e: unknown) => e);
    await Bun.sleep(50);
    const second = r.run(input).catch((e: unknown) => e);
    await Bun.sleep(20);
    expect(r.load).toEqual({ running: 1, queued: 1 });
    await expect(r.run(input)).rejects.toBeInstanceOf(ExtractionBusyError);
    // Free everything: both hung children die at the deadline; nothing leaks.
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBeInstanceOf(ExtractionFailedError);
    expect(b).toBeInstanceOf(ExtractionFailedError);
    expect(r.load).toEqual({ running: 0, queued: 0 });
  }, 15_000);

  test("a queued upload whose client aborts leaves the queue without running", async () => {
    const r = runner({
      deadlineMs: 5_000,
      maxConcurrent: 1,
      maxQueue: 2,
      childEnv: { FAKE_CHILD_MODE: "hang" },
    });
    const first = r.run(input).catch((e: unknown) => e);
    await Bun.sleep(50);
    const controller = new AbortController();
    const queued = r.run(input, { signal: controller.signal });
    await Bun.sleep(20);
    expect(r.load.queued).toBe(1);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ why: "aborted" });
    expect(r.load.queued).toBe(0);
    await first;
  }, 15_000);
});

describe("ChildProcessExtractionRunner (real child)", () => {
  const real = new ChildProcessExtractionRunner({
    entry: REAL,
    deadlineMs: 20_000,
    maxConcurrent: 2,
    maxQueue: 2,
    maxOutputBytes: CHILD_RUNNER_DEFAULTS.maxOutputBytes,
  });
  test("a zip that is neither PPTX nor DOCX is `unsupported` from the child's sniff", async () => {
    await expect(real.run({ bytes: await plainZip(), name: "z" })).rejects.toMatchObject({
      name: "ExtractError",
      code: "unsupported",
    });
  }, 30_000);

  test("a DOCX and a PDF extract through the child exactly as in-process", async () => {
    const docx = await real.run({
      bytes: await docxWith([{ paragraphs: ["Photosynthesis makes sugar."] }]),
      // No mime: the child sniffs it, as in production.
      name: "d",
    });
    expect(docx.mime).toBe(MIME.docx);
    expect(docx.extraction.kind).toBe("docx");
    expect(docx.extraction.chunks[0]?.text).toContain("Photosynthesis");
    const pdf = await real.run({
      bytes: await pdfWithPages(["Rivers flow downhill."], { imageOnPage: 1 }),
      name: "p",
    });
    expect(pdf.mime).toBe(MIME.pdf);
    expect(pdf.extraction.kind).toBe("pdf");
    expect(pdf.extraction.images).toHaveLength(1);
    expect(pdf.extraction.images[0]?.bytes.subarray(1, 4)).toEqual(new TextEncoder().encode("PNG"));
  }, 30_000);

  test("a zip bomb is refused by the child as too-large with no message text", async () => {
    await expect(
      real.run({
        bytes: await pptxBomb(1024 * 1024),
        name: "b",
        limits: { maxUncompressedBytes: 64 * 1024 },
      }),
    ).rejects.toMatchObject({
      name: "ExtractError",
      code: "too-large",
      message: "extract(pptx): too-large",
    });
  }, 30_000);

  test("malformed bytes are malformed", async () => {
    await expect(
      real.run({ bytes: new TextEncoder().encode("%PDF-1.7 nope"), mime: MIME.pdf, name: "x" }),
    ).rejects.toBeInstanceOf(ExtractError);
  }, 30_000);

  test("a real child flushes a response larger than the stdout pipe buffer", async () => {
    const text = "Synthetic teaching paragraph. ".repeat(40_000);
    const result = await real.run({
      bytes: new TextEncoder().encode(text),
      mime: MIME.paste,
      name: "large",
    });
    expect(result.extraction.chunks[0]?.text).toBe(text.trim());
  }, 30_000);
});

describe("config", () => {
  test("childEntryFor follows the api entry's layout", () => {
    expect(childEntryFor("file:///app/apps/api/dist/index.js")).toBe(
      "/app/apps/api/dist/sources/extract-child.js",
    );
    expect(childEntryFor("file:///repo/apps/api/src/index.ts")).toBe(
      "/repo/apps/api/src/sources/extract-child.ts",
    );
  });

  test("loadChildRunnerConfig: defaults, overrides, rejects junk", () => {
    expect(loadChildRunnerConfig({}, "/e")).toMatchObject({
      entry: "/e",
      ...CHILD_RUNNER_DEFAULTS,
    });
    expect(
      loadChildRunnerConfig(
        {
          EXTRACT_DEADLINE_MS: "5000",
          EXTRACT_MAX_CONCURRENT: "3",
          EXTRACT_MAX_QUEUE: "9",
          EXTRACT_CHILD_MAX_VMEM_MB: "2048",
        },
        "/e",
      ),
    ).toMatchObject({
      deadlineMs: 5000,
      maxConcurrent: 3,
      maxQueue: 9,
      vmemLimitMb: 2048,
    });
    expect(() => loadChildRunnerConfig({ EXTRACT_MAX_CONCURRENT: "0" }, "/e")).toThrow();
    expect(() => loadChildRunnerConfig({ EXTRACT_DEADLINE_MS: "soon" }, "/e")).toThrow();
  });
});
