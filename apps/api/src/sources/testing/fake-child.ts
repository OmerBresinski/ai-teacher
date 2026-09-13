/**
 * A stand-in for `extract-child.ts` driven by `FAKE_CHILD_MODE` (extraction-runner.test.ts):
 *   hang           never answers (a synchronous parser that does not return)
 *   flood          writes stdout forever (an over-producing child)
 *   crash          exits 3 without an answer
 *   garbage        exits 0 with non-JSON on stdout
 *   echo (default) answers a minimal extraction after reading stdin, echoing the byte count
 */
const mode = process.env.FAKE_CHILD_MODE ?? "echo";

const bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());

if (mode === "hang") {
  // Busy loop, not a timer: a killable child must die mid-synchronous work.
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    // spin
  }
  process.exit(0);
}
if (mode === "flood") {
  const chunk = "x".repeat(64 * 1024);
  for (;;) process.stdout.write(chunk);
}
if (mode === "crash") process.exit(3);
if (mode === "garbage") {
  process.stdout.write("not json\n");
  process.exit(0);
}
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mime: process.env.EXTRACT_MIME ?? "text/plain",
    extraction: {
      kind: "paste",
      pages: 1,
      chunks: [
        {
          ref: { section: "Paste" },
          text: `bytes:${bytes.byteLength} ${process.env.EXTRACT_MIME}`,
        },
      ],
      tables: [],
      images: [],
    },
  })}\n`,
);
process.exit(0);
