/*
 * Deterministic repair of a structured answer before it is validated (ADR 0025 §14).
 *
 * Sonnet 5 and Haiku 4.5 behind Bedrock get their schema as a forced `json` tool (the provider
 * lists them under `MODELS_WITHOUT_RELIABLE_NATIVE_STRUCTURED_OUTPUT`), and a tool input has one
 * well-known failure mode: the model serialises part or all of the answer as a JSON *string*
 * instead of JSON. Seen in production on 2026-09-07 (plan-skeleton.v1, twice in one job):
 *
 *   { "learningObjectives": "[{\"text\": …}]", "outline": [ … ] }      ← a list as a string
 *   { "learningObjectives": "{\"learningObjectives\": […], \"outline\": […]}" }  ← the answer as a string
 *   { "plan": { "learningObjectives": […], "outline": […] } }             ← the answer under one made-up key
 *
 * All three are the right answer in the wrong wrapper. Unwrapping is a pure function of the text — no
 * second model call, no guessing at content — so it runs before validation and the retry stays
 * for genuine misses. Nothing here logs: the text is the model's output (ADR 0015).
 */

export type JsonRepairKind = "parsed-string" | "hoisted";

export interface JsonRepair {
  /** The repaired JSON text, or `null` when nothing could be changed. */
  text: string | null;
  /** What was done, in order; empty when `text` is `null`. */
  repairs: JsonRepairKind[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string that looks like a JSON array or object and parses as one; otherwise `undefined`. */
function embeddedJson(value: string): unknown {
  const trimmed = value.trim();
  const first = trimmed[0];
  if (first !== "[" && first !== "{") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Replace every string property that is itself JSON with the parsed value, recursively into
 * objects and arrays. Strings that are prose stay strings.
 */
function parseEmbeddedStrings(value: unknown, repairs: JsonRepairKind[]): unknown {
  if (Array.isArray(value)) return value.map((item) => parseEmbeddedStrings(item, repairs));
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      const parsed = embeddedJson(item);
      if (parsed !== undefined && (Array.isArray(parsed) || isObject(parsed))) {
        repairs.push("parsed-string");
        out[key] = parseEmbeddedStrings(parsed, repairs);
        continue;
      }
    }
    out[key] = parseEmbeddedStrings(item, repairs);
  }
  return out;
}

/**
 * `{ plan: { learningObjectives: …, outline: … } }` → `{ learningObjectives: …, outline: … }`:
 * the answer was wrapped in one invented key — as a string (seen 2026-09-07) or as an object
 * (seen 2026-09-08, `1 unrecognized key(s)` with every expected key `undefined`). Only hoists when
 * the outer object has exactly one own key whose value is an object; the caller accepts the
 * result only if it then validates, so a legitimate single-key answer is never lost.
 */
function hoistWrappedAnswer(value: unknown, repairs: JsonRepairKind[]): unknown {
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  const only = keys[0];
  if (keys.length !== 1 || only === undefined) return value;
  const inner = value[only];
  if (!isObject(inner)) return value;
  repairs.push("hoisted");
  return inner;
}

/**
 * Try to repair `text`. Returns the repaired text when at least one repair applied and the
 * result differs, else `{ text: null, repairs: [] }`. Text that is not JSON at all is not
 * repaired here: the retry prompt handles that case.
 */
export function repairJsonText(text: string): JsonRepair {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { text: null, repairs: [] };
  }
  const repairs: JsonRepairKind[] = [];
  const repaired = hoistWrappedAnswer(parseEmbeddedStrings(value, repairs), repairs);
  if (repairs.length === 0) return { text: null, repairs: [] };
  return { text: JSON.stringify(repaired), repairs };
}
