// Re-freeze the diagram kind's default recipes after a deliberate figure look change:
// bun src/fixtures/refreeze-diagram.ts
import { readFileSync, writeFileSync } from "node:fs";
import { layoutSlide } from "../layouts";
import { THEMES } from "../themes";
import { normaliseLayout } from "./normalise";

const path = new URL("./default-recipes.json", import.meta.url);
const frozen = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
for (const t of THEMES) frozen[`diagram/${t.id}`] = normaliseLayout(layoutSlide("diagram", t.id));
writeFileSync(path, `${JSON.stringify(frozen, null, 2)}\n`);
