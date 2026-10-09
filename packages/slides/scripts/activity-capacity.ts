// Writes src/templates/activity-capacity.json: the activity templates' measured capacities.
// Usage: bun packages/slides/scripts/activity-capacity.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureActivities } from "../src/templates/activity-capacity";

const out = join(import.meta.dir, "../src/templates/activity-capacity.json");
writeFileSync(out, `${JSON.stringify(measureActivities(), null, 1)}\n`);
console.log(`wrote ${out}`);
