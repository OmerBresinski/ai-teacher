/**
 * Child-process entry for Source extraction (TEACH-278, audit F02/F03; ADR 0027 §5 amendment).
 *
 * Runs `@tj/extract`'s `extract()` in a process the API can kill: a synchronous inflater or
 * parser that hangs, or a decode that eats memory, dies with this process and never with the API.
 *
 * Protocol (no shell, no file names, no document text outside the two pipes):
 *   env  EXTRACT_MIME     the sniffed MIME (`SourceMime`)
 *        EXTRACT_LIMITS   optional JSON `Partial<ExtractLimits>` (tests scale the caps)
 *   stdin                 the document bytes
 *   stdout                one JSON line: `{ ok: true, extraction }` with image bytes base64, or
 *                         `{ ok: false, code }` where `code` is an `ExtractErrorCode` | "crashed"
 *   stderr                nothing (the parent ignores it; parser messages quote document text)
 *   exit code             0 for either JSON answer; anything else is a crash
 *
 * Built alongside `src/index.ts` into `dist/sources/extract-child.js` (apps/api `build`); the
 * Dockerfile's self-contained check re-bundles it too.
 */
import { ExtractError, type ExtractErrorCode, extract, type SourceMime } from "@tj/extract";
import { type ChildAnswer, encodeExtraction } from "./protocol";

async function readStdin(): Promise<Uint8Array> {
  return new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
}

function answer(value: ChildAnswer): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const mime = process.env.EXTRACT_MIME as SourceMime | undefined;
  if (!mime) {
    answer({ ok: false, code: "unsupported" });
    return;
  }
  const limits = process.env.EXTRACT_LIMITS ? JSON.parse(process.env.EXTRACT_LIMITS) : undefined;
  const bytes = await readStdin();
  try {
    const extraction = await extract({ bytes, mime, name: "upload", limits });
    answer({ ok: true, extraction: encodeExtraction(extraction) });
  } catch (error) {
    const code: ExtractErrorCode | "crashed" =
      error instanceof ExtractError ? error.code : "crashed";
    answer({ ok: false, code });
  }
}

main().then(
  () => process.exit(0),
  () => {
    // Never print the error: it may quote the document.
    process.exit(2);
  },
);
