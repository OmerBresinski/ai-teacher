import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getTheme } from "@tj/slides/themes";
import { writerBundle } from "./bundle";
import { type MaterialiseCtx, toInput } from "./materialise";
import { writerSchema } from "./schema";
import { slotFillArrival, withSlotFill } from "./slot-fill";

/*
 * Review (TEACH-110 part v, 19 Oct 2026): base4g, the non-pack slot-fill bundle, is untouched by
 * wave C. Every base4g def at every stage, filled short and long, goes through slotFillArrival and
 * toInput; the hash below was taken from master's slot-fill.ts and materialise.ts on the same
 * fixtures (268 cases, equal), so any change to base4g's arrival or input fails here.
 */
type J = Record<string, unknown>;
const TEXT = "Sun warms the land so x = 3 and plants grow. ".repeat(20);
const fill = (x: unknown, len: number): unknown => {
  if (!x || typeof x !== "object") return undefined;
  const s = x as J & { anyOf?: unknown[]; enum?: unknown[] };
  if (s.$ref) return undefined;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.type === "string")
    return TEXT.slice(0, Math.max(1, ((s.maxLength as number | undefined) ?? 40) + len)).trim();
  if (s.type === "integer" || s.type === "number") return 1;
  if (s.type === "boolean") return true;
  if (s.properties)
    return Object.fromEntries(Object.entries(s.properties as J).map(([k, v]) => [k, fill(v, len)]));
  if (s.items) return [fill(s.items, len), fill(s.items, len), fill(s.items, len)];
  if (Array.isArray(s.anyOf)) return fill(s.anyOf[0], len);
  return undefined;
};

describe("base4g (no pack) is master's through slot-fill and materialise", () => {
  test("268 arrivals and inputs hash to master's", () => {
    const h = createHash("sha1");
    let n = 0;
    for (const st of ["KS1", "KS2", "KS3-5"] as const) {
      const schema = withSlotFill(
        writerSchema(st, { min: 9, max: 12 }, writerBundle("base4g"), { objectives: 3 }),
        st,
      );
      const stage = st === "KS1" ? "ks1" : st === "KS2" ? "ks2" : "ks3";
      const defs = Object.entries(schema.$defs as Record<string, J>).sort();
      for (const [name, def] of defs) {
        if (!(def?.properties as J | undefined)?.template) continue;
        for (const len of [-20, 10]) {
          const slide = fill(def, len) as J;
          const a = slotFillArrival(structuredClone(slide), st, schema);
          let inp: unknown;
          try {
            inp = toInput(a.slide, {
              brief: { subject: "science", topic: "x", stage },
              theme: getTheme("splash", stage),
              stage,
              index: 3,
              plan: { slides: [a.slide] },
              visual: (k: string) => ({
                status: "photo",
                photo: { src: `/files/${k}.jpg`, alt: k, aspect: 4 / 3 },
              }),
            } as unknown as MaterialiseCtx);
          } catch (e) {
            inp = `throw ${(e as Error).message}`;
          }
          h.update(JSON.stringify([name, len, a, inp]));
          n++;
        }
      }
    }
    expect(n).toBe(268);
    expect(h.digest("hex")).toBe("ef99ec91d2480d57cf69bd2af6e2e50b15df87e8");
  });
});
