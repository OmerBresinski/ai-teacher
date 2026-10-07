import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { diagramKindsFile } from "./diagram-kinds";

// r5: the prompt folders' generated kinds file, where this checkout has it, is not stale.
const FILE = `${import.meta.dir}/../../scratchpad/quality-prd/lab/rounds/BAKEOFF/prompts/shared/diagram-kinds.json`;
test.skipIf(!existsSync(FILE))("prompts/shared/diagram-kinds.json matches the drawer", () => {
  const onDisk = JSON.parse(readFileSync(FILE, "utf8"));
  expect(onDisk).toEqual(JSON.parse(JSON.stringify(diagramKindsFile())));
});
