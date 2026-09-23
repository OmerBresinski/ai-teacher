#!/usr/bin/env bun
// bun packages/generation/eval/pack-sources.ts --wikipedia <Title> [--wikipedia <Title>…] [--html <url>…]
//   [--out <dir>] [--refresh] [--licence CC-BY-SA-4.0|CC-BY-4.0|permission|public-domain]
//
// Fetches each source politely (see `packs/sources.ts`), caches the raw page under
// `scratchpad/data/sources/` (outside the repo), and writes `<slug>.sentences.json` beside it:
// the page's numbered sentences with their headings, the pack's evidence vocabulary. No model
// call. Prints one line per source: title, revision id, sentence count, cache hit.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_CACHE_DIR,
  fetchPage,
  type SourceRequest,
  slugOf,
  toPackSource,
} from "./packs/sources";

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1] as string);
  });
  return out;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

if (import.meta.main) {
  const licence = (args("licence")[0] ?? "CC-BY-SA-4.0") as SourceRequest["licence"];
  const requests: SourceRequest[] = [
    ...args("wikipedia").map((ref): SourceRequest => ({ kind: "wikipedia", ref, licence })),
    ...args("html").map((ref): SourceRequest => ({ kind: "html", ref, licence })),
  ];
  if (requests.length === 0) {
    console.error(
      "usage: pack-sources.ts --wikipedia <Title> [--html <url>] [--out dir] [--refresh]",
    );
    process.exit(2);
  }
  const cacheDir = args("out")[0] ?? DEFAULT_CACHE_DIR;
  let ordinal = 0;
  for (const req of requests) {
    const page = await fetchPage(req, { cacheDir, refresh: flag("refresh") });
    const source = toPackSource(page, ++ordinal, req.licence);
    const slug = slugOf(req.kind === "wikipedia" ? req.ref.replace(/ /g, "_") : req.ref);
    await writeFile(join(cacheDir, `${slug}.sentences.json`), JSON.stringify(source, null, 2));
    const headings = new Set(source.sentences.map((s) => s.heading)).size;
    console.log(
      `${source.title} — revision ${source.revision}; ${source.sentences.length} sentences under ${headings} headings; ${page.fromCache ? "cache" : "fetched"}; ${source.url}`,
    );
  }
}
