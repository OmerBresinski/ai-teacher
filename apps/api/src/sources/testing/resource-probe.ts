/** Run against the built Node child in a disposable Linux container; never production data. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIME } from "@tj/extract";
import { docxWith, pdfWithPages, pptxBomb, pptxWith, squarePng } from "@tj/extract/testing";
import {
  CHILD_RUNNER_DEFAULTS,
  ChildProcessExtractionRunner,
  ExtractionFailedError,
} from "../extraction-runner";

export async function resourceProbe(entry: string): Promise<void> {
  assert.equal(process.platform, "linux");
  assert.ok(entry.endsWith(".mjs"));
  const config = {
    ...CHILD_RUNNER_DEFAULTS,
    entry,
    maxConcurrent: 1,
    maxQueue: 1,
    deadlineMs: 15_000,
  };
  const runner = new ChildProcessExtractionRunner(config);
  const picture = await squarePng();
  const inputs = [
    { kind: "pdf", bytes: await pdfWithPages(["Synthetic teaching text."], { imageOnPage: 1 }) },
    {
      kind: "docx",
      bytes: await docxWith([
        { heading: "Synthetic topic", paragraphs: ["Synthetic teaching text."], image: picture },
      ]),
    },
    {
      kind: "pptx",
      bytes: await pptxWith([{ paragraphs: ["Synthetic teaching text."], image: picture }]),
    },
  ];
  for (const input of inputs) {
    console.log(JSON.stringify({ event: "begin-extraction", kind: input.kind }));
    const { extraction } = await runner.run({ bytes: input.bytes, name: "synthetic" });
    assert.equal(extraction.kind, input.kind);
    assert.ok(extraction.chunks.length > 0);
    assert.equal(extraction.images.length, 1);
    console.log(
      JSON.stringify({
        event: "valid-extraction",
        kind: input.kind,
        inputBytes: input.bytes.byteLength,
        chunks: extraction.chunks.length,
        images: extraction.images.length,
      }),
    );
  }
  await assert.rejects(
    runner.run({
      bytes: await pptxBomb(1024 * 1024),
      name: "scaled-bomb",
      limits: { maxUncompressedBytes: 64 * 1024 },
    }),
    { code: "too-large" },
  );

  const directory = await mkdtemp(join(tmpdir(), "extraction-memory-probe-"));
  try {
    const hog = join(directory, "memory-hog.mjs");
    await writeFile(
      hog,
      'const held=[];for(let i=0;i<96;i++){const b=new Uint8Array(16*1024*1024);b.fill(1);held.push(b)}process.stdout.write("unexpected-unbounded-success");',
    );
    const limited = new ChildProcessExtractionRunner({ ...config, entry: hog });
    await assert.rejects(
      limited.run({ bytes: new Uint8Array(), mime: MIME.paste, name: "memory-probe" }),
      { why: "crashed" },
    );
    assert.deepEqual(limited.load, { running: 0, queued: 0 });
    // The parent survived and continues serving valid work after the memory-limited child failed.
    const next = await runner.run({
      bytes: new TextEncoder().encode("Still serving synthetic requests."),
      mime: MIME.paste,
      name: "after-failure",
    });
    assert.equal(next.extraction.kind, "paste");
    console.log(
      JSON.stringify({
        event: "memory-contained",
        vmemLimitMb: config.vmemLimitMb,
        parentAlive: true,
        slotsReleased: true,
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const deadline = setTimeout(() => process.exit(3), 90_000);
  resourceProbe(process.argv[2] ?? "/app/apps/api/dist/sources/extract-child.mjs").then(
    () => {
      clearTimeout(deadline);
      console.log(JSON.stringify({ event: "resource-probe-passed", arch: process.arch }));
      process.exit(0);
    },
    (error: unknown) => {
      clearTimeout(deadline);
      console.log(
        JSON.stringify({
          event: "resource-probe-failed",
          errorType: error instanceof Error ? error.name : "unknown",
          ...(error instanceof ExtractionFailedError
            ? { why: error.why, exitCode: error.exitCode }
            : {}),
        }),
      );
      process.exit(1);
    },
  );
}
