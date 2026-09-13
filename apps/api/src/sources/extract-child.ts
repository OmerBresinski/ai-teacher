/**
 * Child-process entry for Source extraction (TEACH-278, audit F02/F03; ADR 0027 §5 amendment).
 *
 * Runs `@tj/extract`'s `extract()` in a process the API can kill: a synchronous inflater or
 * parser that hangs, or a decode that eats memory, dies with this process and never with the API.
 *
 * Protocol (no shell, no file names, no document text outside the two pipes):
 *   env  EXTRACT_MIME     `text/plain` for a paste; unset for a file, which the child sniffs itself
 *                         (the zip central-directory parse belongs in here, not in the API)
 *        EXTRACT_LIMITS   optional JSON `Partial<ExtractLimits>` (tests scale the caps)
 *   stdin                 the document bytes
 *   stdout                one JSON line: `{ ok: true, mime, extraction }` with image bytes base64,
 *                         or `{ ok: false, code }`, `code` an `ExtractErrorCode` | "crashed"
 *   stderr                nothing (the parent ignores it; parser messages quote document text)
 *   exit code             0 for either JSON answer; anything else is a crash
 *
 * Built alongside `src/index.ts` into `dist/sources/extract-child.js` (apps/api `build`); the
 * Dockerfile's self-contained check re-bundles it too.
 */
import { ExtractError, extract, resolveLimits, type SourceMime, sniffMime } from "@tj/extract";
import { type ChildAnswer, encodeExtraction } from "./protocol";

async function readStdin(): Promise<Uint8Array> {
  return new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
}

/** Write the answer and wait for the pipe to drain: `process.exit` right after `write` truncates. */
function answer(value: ChildAnswer): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

async function main(): Promise<void> {
  const limits = resolveLimits(
    process.env.EXTRACT_LIMITS ? JSON.parse(process.env.EXTRACT_LIMITS) : undefined,
  );
  const bytes = await readStdin();
  try {
    const declared = process.env.EXTRACT_MIME as SourceMime | undefined;
    const mime = declared ?? (await sniffMime(bytes, limits));
    if (mime === null) {
      await answer({ ok: false, code: "unsupported", format: "unknown" });
      return;
    }
    const extraction = await extract({ bytes, mime, name: "upload", limits });
    await answer({ ok: true, mime, extraction: encodeExtraction(extraction) });
  } catch (error) {
    await answer(
      error instanceof ExtractError
        ? { ok: false, code: error.code, format: error.format }
        : { ok: false, code: "crashed", format: "unknown" },
    );
  }
}

main().then(
  () => process.exit(0),
  () => {
    // Never print the error: it may quote the document.
    process.exit(2);
  },
);
