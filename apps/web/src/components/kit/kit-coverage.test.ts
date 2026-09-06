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
  // Plain function components and exotic ones (`forwardRef`/`memo` objects carry `$$typeof`).
  const isComponent = (value: unknown) =>
    typeof value === "function" ||
    (typeof value === "object" && value !== null && "$$typeof" in value);
  const exports = Object.entries(ui)
    .filter(([name, value]) => /^[A-Z]/.test(name) && isComponent(value))
    .map(([name]) => name);

  expect(exports.length).toBeGreaterThan(40);
  expect(exports.filter((name) => !gallerySource.includes(name))).toEqual([]);
});
