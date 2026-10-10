/** Test helper: a JSON object, as the writer's schema and outputs are handled in tests. */
type J = Record<string, unknown>;
type S = Record<string, unknown>;

/** A strict-mode subset validator: what the writer's schema uses, nothing more. */
export function validate(schema: J, v: unknown, root: J = schema, path = "$"): string[] {
  if (schema.$ref) {
    const name = String(schema.$ref).replace("#/$defs/", "");
    return validate((root.$defs as Record<string, J>)[name] as J, v, root, path);
  }
  if (schema.anyOf) {
    const each = (schema.anyOf as J[]).map((x) => validate(x, v, root, path));
    return each.some((e) => e.length === 0) ? [] : [`${path}: no anyOf branch (${each[0]?.[0]})`];
  }
  if (schema.enum && !(schema.enum as unknown[]).includes(v)) return [`${path}: not in enum`];
  const t = schema.type;
  if (t === "null") return v === null ? [] : [`${path}: not null`];
  if (t === "string") {
    if (typeof v !== "string") return [`${path}: not a string`];
    return typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(v)
      ? [`${path}: not ${schema.pattern}`]
      : [];
  }
  if (t === "integer" || t === "number") {
    if (typeof v !== "number" || (t === "integer" && !Number.isInteger(v)))
      return [`${path}: not a ${t}`];
    if (typeof schema.minimum === "number" && v < schema.minimum) return [`${path}: low`];
    if (typeof schema.maximum === "number" && v > schema.maximum) return [`${path}: high`];
    return [];
  }
  if (t === "boolean") return typeof v === "boolean" ? [] : [`${path}: not a boolean`];
  if (t === "array") {
    if (!Array.isArray(v)) return [`${path}: not an array`];
    if (typeof schema.minItems === "number" && v.length < schema.minItems) return [`${path}: few`];
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) return [`${path}: many`];
    return v.flatMap((x, k) => validate(schema.items as J, x, root, `${path}[${k}]`));
  }
  if (t === "object") {
    if (!v || typeof v !== "object") return [`${path}: not an object`];
    const props = (schema.properties ?? {}) as Record<string, J>;
    const o = v as S;
    const missing = (schema.required as string[]).filter((k) => !(k in o));
    const extra = Object.keys(o).filter((k) => !(k in props));
    return [
      ...missing.map((k) => `${path}.${k}: missing`),
      ...extra.map((k) => `${path}.${k}: extra`),
      ...Object.entries(props).flatMap(([k, p]) =>
        k in o ? validate(p, o[k], root, `${path}.${k}`) : [],
      ),
    ];
  }
  return [];
}
