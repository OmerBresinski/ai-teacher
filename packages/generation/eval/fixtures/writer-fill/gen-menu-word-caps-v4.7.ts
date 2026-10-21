/**
 * Regenerates `menu-word-caps-v4.7.json`: the numbers v4.7's menu printed, as `menuWordCaps` data,
 * for the fill score of v4.7 runs. v4.7 is frozen as master shipped it (`pilot-v4.7/system-KS*.txt`,
 * master's `pilot-v4.7-menu` snapshot after #582), so the numbers come from that checkout's own
 * `menuWordCaps`, never from this branch's menu or by hand:
 *
 *   bun packages/generation/eval/fixtures/writer-fill/gen-menu-word-caps-v4.7.ts <master checkout>
 */
import { writeFileSync } from "node:fs";

const root = process.argv[2];
if (!root) throw new Error("usage: gen-menu-word-caps-v4.7.ts <master checkout>");
const { menuWordCaps } = await import(`${root}/packages/generation/src/writer/layout-menu.ts`);
const out = { KS2: menuWordCaps("KS2"), "KS3-5": menuWordCaps("KS3-5") };
writeFileSync(
  new URL("./menu-word-caps-v4.7.json", import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log("wrote menu-word-caps-v4.7.json from", root);
