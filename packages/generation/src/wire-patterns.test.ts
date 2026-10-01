import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SLOT_CONTRACTS } from "@tj/slides";
import { z } from "zod";
import { ParseBriefOutputSchema } from "./parse-brief";
import { SET_FORMS, slideWriterSchema } from "./plan-write/menu";
import { streamLessonSchema } from "./plan-write/stream";
import { planLessonSchema } from "./prompts/plan-lesson";
import { CheckInputOutputSchema, EvaluateOutputSchema } from "./specs";

/*
 * Every `pattern` in a schema sent to the model must be in the regex subset OpenAI's structured
 * outputs accept. One unsupported feature fails the whole request (HTTP 400 "is not a regex"):
 * `\p{L}` in a writer schema broke every stream write in round M (1 Oct 2026). A check that needs
 * one goes in a `refine`, which never reaches the wire.
 */
const UNSUPPORTED: [string, RegExp][] = [
  ["unicode property \\p{..} / \\P{..}", /\\[pP]\{/],
  ["lookahead (?= / (?!", /\(\?[=!]/],
  ["lookbehind (?<= / (?<!", /\(\?<[=!]/],
  ["named group (?<name>", /\(\?<[A-Za-z]/],
  ["backreference \\1 / \\k<..>", /\\[1-9]|\\k</],
  ["inline flags (?i)", /\(\?[a-z]+[):]/],
  ["word boundary \\b / \\B", /\\[bB]/],
];

function unsupportedRegexFeatures(source: string): string[] {
  return UNSUPPORTED.filter(([, re]) => re.test(source)).map(([name]) => name);
}

function patternsIn(node: unknown, at = "$"): { at: string; pattern: string }[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => patternsIn(n, `${at}[${i}]`));
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
    const found =
      key === "pattern" && typeof value === "string"
        ? [{ at: `${at}.pattern`, pattern: value }]
        : [];
    const props =
      key === "patternProperties" && value && typeof value === "object"
        ? Object.keys(value).map((p) => ({ at: `${at}.patternProperties`, pattern: p }))
        : [];
    return [...found, ...props, ...patternsIn(value, `${at}.${key}`)];
  });
}

const wire = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" });

const fullMenu = [
  ...SLOT_CONTRACTS.filter((c) => c.form !== "notes" && c.form !== "worksheet").map((c) => ({
    form: c.form as string,
    layout: c.layout,
    contract: "",
  })),
  ...SET_FORMS.map((form) => ({ form: form as string, layout: "default", contract: "" })),
];

const schemas: [string, z.ZodType][] = [
  ["streamLessonSchema (every form and layout)", streamLessonSchema(fullMenu)],
  ["planLessonSchema", planLessonSchema],
  ["ParseBriefOutputSchema", ParseBriefOutputSchema],
  ["CheckInputOutputSchema", CheckInputOutputSchema],
  ["EvaluateOutputSchema", EvaluateOutputSchema],
  ...fullMenu.map(
    (m) =>
      [`slideWriterSchema ${m.form}/${m.layout}`, slideWriterSchema(m.form, m.layout)] as [
        string,
        z.ZodType,
      ],
  ),
];

describe("schemas sent to the model use only OpenAI-supported regex", () => {
  test("the detector catches the round M pattern", () => {
    expect(unsupportedRegexFeatures("\\S\\s*\\([^()]*\\p{L}{2}[^()]*\\)\\s*$")).toEqual([
      "unicode property \\p{..} / \\P{..}",
    ]);
    expect(unsupportedRegexFeatures("^(?<!x)a(?=b)$")).toHaveLength(2);
    expect(unsupportedRegexFeatures("^[A-Za-z]{2}\\d+(\\s|-)?$")).toEqual([]);
  });

  test.each(schemas)("%s", (_name, schema) => {
    const bad = patternsIn(wire(schema))
      .map((p) => ({ ...p, features: unsupportedRegexFeatures(p.pattern) }))
      .filter((p) => p.features.length > 0);
    expect(bad).toEqual([]);
  });

  test("no .regex() in model-facing source uses an unsupported feature", () => {
    // Schemas built per call (the *SchemaFor factories) are covered by scanning every `.regex(`
    // argument in the source: an inline literal, or a const regex in the same file.
    const roots = [join(import.meta.dir), join(import.meta.dir, "../../slides/src")];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
      });
    const files = roots.flatMap(walk);
    const bad: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\.regex\(\s*(\/(?:\\.|[^/\n])+\/[a-z]*|[A-Za-z_$][\w$]*)/g)) {
        const arg = m[1] ?? "";
        const literal = arg.startsWith("/")
          ? arg
          : src.match(new RegExp(`const ${arg}\\s*=\\s*(\\/(?:\\\\.|[^/\\n])+\\/[a-z]*)`))?.[1];
        if (!literal) continue;
        const features = unsupportedRegexFeatures(literal.slice(1, literal.lastIndexOf("/")));
        if (features.length) bad.push(`${file}: ${arg} ${features.join(", ")}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
