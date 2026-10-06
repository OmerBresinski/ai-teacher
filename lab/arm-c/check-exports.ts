// Arm C: every name the real find_picture path uses exists (no calls).
const W = `${import.meta.dir}/../..`;
const want: [string, string[]][] = [
  ["packages/ai/src/index.ts", ["createAi", "createBudget"]],
  ["packages/generation/src/stages/illustrate.ts", ["pickPhoto", "judgeMade", "plainSubject"]],
  ["packages/generation/src/stages/photo-bank.ts", ["mustShowOf"]],
  ["packages/generation/src/stages/picture-director.ts", ["findDirected"]],
  [
    "packages/images/src/index.ts",
    [
      "createPexelsClient",
      "createCommonsClient",
      "storePhoto",
      "createOpenAiEmbedder",
      "createOpenAiImageGenerator",
    ],
  ],
  ["packages/db/src/index.ts", ["createDb"]],
  ["packages/storage/src/index.ts", ["createStorage"]],
  ["apps/worker/src/picture-bank.ts", ["createPictureBank"]],
  ["packages/domain/src/index.ts", ["newId"]],
];
let bad = 0;
for (const [f, names] of want) {
  const m = await import(`${W}/${f}`);
  for (const n of names)
    if (typeof m[n] !== "function") {
      bad++;
      console.log("MISSING", f, n);
    }
}
const pino = (await import(`${W}/apps/worker/node_modules/pino/pino.js`)).default;
if (typeof pino !== "function") {
  bad++;
  console.log("MISSING pino");
}
console.log(bad ? `${bad} missing` : "all exports present");
process.exit(bad ? 1 : 0);
