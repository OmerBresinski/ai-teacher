/**
 * Dotted input paths of an adaptive layout's `LayoutRef` (TEACH-205 part b), shared by the lazy
 * relayout (`./relayout`) and the editor's history, which writes a child's new words through to
 * the ref. Kept out of `@tj/domain`'s barrel and `@tj/slides`' index so they load only with the
 * editor, not on every lesson page.
 */
import type { LayoutRef } from "@tj/domain/documents";

const segs = (path: string) => path.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));

/** The value at a dotted path ("grid.1.text") in the ref's input. */
export function getAtPath(ref: LayoutRef, path: string): unknown {
  let v: unknown = ref.input;
  for (const k of segs(path)) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string | number, unknown>)[k];
  }
  return v;
}

/** A copy of the ref with one value set at a dotted path; the source is untouched. */
export function setAtPath(ref: LayoutRef, path: string, value: unknown): LayoutRef {
  const put = (node: unknown, keys: (string | number)[]): unknown => {
    const [k, ...rest] = keys;
    if (k === undefined) return value;
    const next = rest.length ? put((node as Record<string | number, unknown>)?.[k], rest) : value;
    if (Array.isArray(node)) {
      const arr = [...node];
      arr[k as number] = next;
      return arr;
    }
    return { ...((node as object) ?? {}), [k]: next };
  };
  return { ...ref, input: put(ref.input, segs(path)) as Record<string, unknown> };
}

/**
 * The input path a layout group's child shows, from its id (`<groupId>:<path>`, written by
 * `relayout`); undefined for a child that is not bound to a field (`<groupId>:<n>`).
 */
export function boundPath(groupId: string, childId: string): string | undefined {
  const prefix = `${groupId}:`;
  if (!childId.startsWith(prefix)) return undefined;
  const path = childId.slice(prefix.length);
  return /^\d+$/.test(path) || !path ? undefined : path;
}
