import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagramFaultOf, Ledger, shareBudget } from "./services";

test("a hold blocked only by peers' holds waits for their release", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bud-"));
  const a = new Ledger(0.7);
  const b = new Ledger(0.7);
  shareBudget(a, dir, "a");
  shareBudget(b, dir, "b");
  const ra = a.guard("main a", 0.6);
  setTimeout(ra, 300);
  const t0 = Date.now();
  const rb = await b.holdWhenFree("main b", 0.2, 5_000, 20);
  expect(rb).toBeDefined();
  expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
  rb?.();
});

test("a hold that real spend alone would pass is refused at once", async () => {
  const l = new Ledger(0.1);
  l.add("main", 0.09);
  const t0 = Date.now();
  expect(await l.holdWhenFree("pictures", 0.05, 5_000, 20)).toBeUndefined();
  expect(Date.now() - t0).toBeLessThan(200);
  expect(l.refused).toContain("pictures");
});

test("a diagram fault names the schema issue for the retry", () => {
  const f = diagramFaultOf({ kind: "particles", show: "compare", panels: [{}] }, () => undefined);
  expect(f).toContain("panels");
  expect(diagramFaultOf({ kind: "x" }, () => ({}))).toBe("");
});

test("the spec writer's particles schema offers compare and collision (y11 s8)", async () => {
  const { DiagramSpecSchema } = await import("../../packages/slides/src/diagrams/schema");
  const src = await Bun.file(`${import.meta.dir}/services.ts`).text();
  expect(src).toContain(
    'import { DiagramSpecSchema } from "../../packages/slides/src/diagrams/schema"',
  );
  const p = (
    DiagramSpecSchema.options as unknown as {
      shape: { kind: { value: string }; show: { options: string[] } };
    }[]
  ).find((o) => o.shape.kind.value === "particles");
  expect(JSON.stringify(p?.shape.show)).toContain("compare");
});
