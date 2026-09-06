import { expect, test } from "bun:test";
import * as ui from "@tj/ui";

const kitFiles = [
  "actions.tsx",
  "choice.tsx",
  "chrome.tsx",
  "content.tsx",
  "feedback.tsx",
  "foundations.tsx",
  "frame.tsx",
  "inventory.tsx",
  "motion.tsx",
  "overlays.tsx",
  "text-entry.tsx",
  "value.tsx",
];

test("every PascalCase @tj/ui component export is represented in the kit", async () => {
  const source = await Promise.all(
    kitFiles.map((file) => Bun.file(new URL(`./${file}`, import.meta.url)).text()),
  );
  const gallerySource = source.join("\n");
  const exports = Object.entries(ui)
    .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
    .map(([name]) => name);

  expect(exports.filter((name) => !gallerySource.includes(name))).toEqual([]);
});
