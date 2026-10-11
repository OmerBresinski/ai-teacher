/**
 * Seed the production picture library from the lab's (TEACH-84 part b, SEED.md). A dry run unless
 * `--apply`; written to be run by a person, never by CI or the worker.
 *
 *   bun apps/worker/src/scripts/seed-picture-library.ts \
 *     --from postgres://…:5636/… --from-root <lab STORAGE_ROOT> \
 *     --to   postgres://…           [--apply]
 *
 * `--to` storage comes from the usual `S3_*` / `STORAGE_ROOT` variables (`createStorage`). Rows
 * that qualify (`qualifies`) are copied with their bytes under the same
 * `<LIBRARY_WORKSPACE_ID>/bank/<id>.<ext>` key and the same embedding (same model). A row whose id
 * is already in the target is skipped, so a second run copies nothing. Prints counts and bytes
 * only, never request, alt or prompt text (ADR 0015).
 */
import { parseArgs } from "node:util";
import {
  type BankImageRow,
  bankImageIdsIn,
  copyBankImage,
  createDb,
  readyBankImages,
} from "@tj/db";
import { LIBRARY_WORKSPACE_ID } from "@tj/domain";
import type { PhotoSource } from "@tj/domain/documents";
import { bankLicenceOk, EMBED_DIMENSIONS, EMBED_MODEL } from "@tj/images";
import { createStorage, LocalDiskStorage } from "@tj/storage";

export type SeedVerdict =
  | "ok"
  | "not-ready"
  | "embedding"
  | "licence"
  | "credit"
  | "provenance"
  | "ruling-163"
  | "key";

/**
 * Whether a lab row may enter the production library:
 * - ready rows embedded with today's model and size only;
 * - stock (Pexels, Commons) with a licence the library admits (ruling 139) and a credit;
 * - generated pictures with their generator and terms, never a stand-in for a real or historical
 *   thing (route `real`, or flagged faithful or depicting): ruling 163 keeps those out;
 * - stored under the library's own prefix.
 */
export function qualifies(row: BankImageRow): SeedVerdict {
  if (row.status !== "ready") return "not-ready";
  if (row.embedModel !== EMBED_MODEL || row.embedDims !== EMBED_DIMENSIONS) return "embedding";
  const source = row.source as PhotoSource;
  if (!bankLicenceOk(source) || source.provider !== row.provider) return "licence";
  const flags = (row.flags ?? {}) as { faithful?: boolean; depicts?: boolean; drawn?: boolean };
  if (row.provider === "generated") {
    if (!row.generator || !row.generatorTerms) return "provenance";
    if (!flags.drawn && (row.route === "real" || flags.faithful || flags.depicts))
      return "ruling-163";
  } else {
    if (!row.credit?.trim() || !row.licence?.trim()) return "credit";
  }
  if (!row.storageKey.startsWith(`${LIBRARY_WORKSPACE_ID}/bank/`)) return "key";
  return "ok";
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: "string" },
      "from-root": { type: "string" },
      to: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (!values.from || !values["from-root"] || !values.to)
    throw new Error("usage: --from <lab url> --from-root <lab storage root> --to <target url>");
  const lab = createDb(values.from);
  const target = createDb(values.to);
  const labFiles = new LocalDiskStorage(values["from-root"]);
  const targetFiles = createStorage({
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
    STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL,
  }).adapter;
  try {
    const rows = await readyBankImages(lab.unsafeDb);
    const verdicts = new Map<SeedVerdict, number>();
    const byProvider = new Map<string, { n: number; bytes: number }>();
    const keep = rows.filter((r) => {
      const v = qualifies(r);
      verdicts.set(v, (verdicts.get(v) ?? 0) + 1);
      if (v !== "ok") return false;
      const p = byProvider.get(r.provider) ?? { n: 0, bytes: 0 };
      byProvider.set(r.provider, { n: p.n + 1, bytes: p.bytes + r.byteSize });
      return true;
    });
    const present = new Set<string>();
    for (let i = 0; i < keep.length; i += 500) {
      const ids = keep.slice(i, i + 500).map((r) => r.id);
      for (const id of await bankImageIdsIn(target.unsafeDb, ids)) present.add(id);
    }
    const todo = keep.filter((r) => !present.has(r.id));
    console.log(
      JSON.stringify(
        {
          mode: values.apply ? "apply" : "dry-run",
          labReady: rows.length,
          verdicts: Object.fromEntries(verdicts),
          qualifying: Object.fromEntries(byProvider),
          alreadyInTarget: present.size,
          toCopy: todo.length,
          toCopyBytes: todo.reduce((s, r) => s + r.byteSize, 0),
        },
        null,
        2,
      ),
    );
    if (!values.apply) return;
    let copied = 0;
    for (const row of todo) {
      const obj = await labFiles.get(row.storageKey);
      const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
      await targetFiles.put(row.storageKey, bytes, { contentType: row.mime });
      await copyBankImage(target.unsafeDb, { ...row, useCount: 0, lastUsedAt: null });
      copied++;
      if (copied % 250 === 0) console.log(`copied ${copied}/${todo.length}`);
    }
    console.log(`copied ${copied}`);
  } finally {
    await lab.close();
    await target.close();
  }
}

if (import.meta.main) await main();
