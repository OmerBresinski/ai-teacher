import type { z } from "zod";

/**
 * lab/t3: how far past its limit a label may run when the drawing is checked to fit it (wrapped
 * onto more lines, or the labels a step smaller). The limits stay the writer's contract; this is
 * the room the materialiser gives a label that misses by a few characters before rejecting it.
 */
export const LONG_LABEL_STRETCH = 1.5;

type Issue = {
  code: string;
  path: PropertyKey[];
  message: string;
  origin?: string;
  maximum?: unknown;
};
const at = (o: unknown, path: PropertyKey[]): unknown =>
  path.reduce<unknown>((v, k) => (v as Record<PropertyKey, unknown> | undefined)?.[k], o);
const put = (o: unknown, path: PropertyKey[], value: unknown) => {
  const parent = at(o, path.slice(0, -1)) as Record<PropertyKey, unknown> | undefined;
  const last = path[path.length - 1];
  if (parent && last !== undefined) parent[last] = value;
};

/**
 * `spec` parsed by `schema` when its only faults are labels over their limit by no more than the
 * stretch: parsed with each long label held at its limit, then the whole label put back. Anything
 * else: the reasons (`path: message`, or `path: N characters, past M` for a label past the
 * stretch). `issues` are the strict parse's issues for `spec`.
 */
export function parseStretched<T>(
  schema: z.ZodType<T>,
  spec: unknown,
  issues: readonly Issue[],
): { data?: T; reasons: string[] } {
  const long: { path: PropertyKey[]; text: string; max: number }[] = [];
  const reasons: string[] = [];
  for (const i of issues) {
    const value = at(spec, i.path);
    const max = typeof i.maximum === "number" ? i.maximum : Number(i.maximum);
    const where = i.path.join(".");
    if (i.code !== "too_big" || i.origin !== "string" || typeof value !== "string") {
      reasons.push(`${where}: ${i.message}`);
      continue;
    }
    const text = value.trim();
    if (text.length > Math.floor(max * LONG_LABEL_STRETCH))
      reasons.push(
        `${where}: ${text.length} characters, past ${Math.floor(max * LONG_LABEL_STRETCH)}`,
      );
    else long.push({ path: i.path, text, max });
  }
  if (reasons.length > 0 || long.length === 0) return { reasons };
  const held = structuredClone(spec);
  for (const l of long) put(held, l.path, l.text.slice(0, l.max));
  const r = schema.safeParse(held);
  if (!r.success)
    return { reasons: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  for (const l of long) put(r.data, l.path, l.text);
  return { data: r.data, reasons: [] };
}
