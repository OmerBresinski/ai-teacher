// D18 structural arms on base3 (8 Oct): schema transforms, generated from base3's pinned schemas, never typed out.
// - b3-r1t (RADICAL.md §R1 stage 1): question-set and practice carry `pictures`, 0-4 one-thing tiles (must_see 1-2),
//   instead of one `picture`; every question, instruction and lead is {text, needs_picture} (needs_picture required).
// - b3-ms: a nullable top-level `misconception` {belief, correcting_example}, before the flow.
// Field descriptions come from the prompt-engineer (ab/arms3/<arm>/REQUEST.md -> DESCRIPTIONS.json); until then none.
// bun lab/bakeoff/ab/structural.ts  -> writes ab/prompts/b3-{r1t,ms}/T/schema.<stage>.json from base3's.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AB, STAGES } from "./arms";

type J = Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Descriptions the prompt-engineer worded, by key (absent until the wording arrives). */
function descriptions(arm: string): Record<string, string> {
  const f = `${AB}/arms3/${arm}/DESCRIPTIONS.json`;
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, string>) : {};
}
const withDesc = (node: J, d?: string): J => (d ? { ...node, description: d } : node);

const QUESTION_LAYOUTS = ["question-set", "practice"];
const ITEM_LAYOUTS = ["question-set", "practice", "exit-ticket"];

/** R1 stage 1 on a base3 writer schema. */
export function r1tSchema(base: J, desc: Record<string, string> = {}): J {
  const s = clone(base);
  const defs = s.$defs as Record<string, J>;
  defs.item = {
    type: "object",
    additionalProperties: false,
    required: ["text", "needs_picture"],
    properties: {
      text: withDesc({ type: "string" }, desc["item.text"]),
      needs_picture: withDesc({ type: "boolean" }, desc["item.needs_picture"]),
    },
  };
  const pic = defs.picture as J & { properties: J; required: string[] };
  defs.tile = withDesc(
    {
      ...clone(pic),
      properties: {
        ...clone(pic.properties),
        must_see: { ...(clone(pic.properties.must_see) as J), minItems: 1, maxItems: 2 },
      },
    },
    desc.tile,
  );
  const ITEM = { $ref: "#/$defs/item" };
  for (const [name, d] of Object.entries(defs)) {
    const props = d.properties as J | undefined;
    if (!props) continue;
    if (ITEM_LAYOUTS.includes(name)) {
      const q = props.questions as J;
      props.questions = withDesc(
        { ...q, items: ITEM },
        desc[`${name}.questions`] ?? desc.questions,
      );
      props.instruction = { anyOf: [ITEM, { type: "null" }] };
    }
    if (QUESTION_LAYOUTS.includes(name)) {
      const order = Object.keys(props).map((k) => (k === "picture" ? "pictures" : k));
      const next: J = {};
      for (const k of order)
        next[k] =
          k === "pictures"
            ? withDesc(
                { type: "array", items: { $ref: "#/$defs/tile" }, minItems: 0, maxItems: 4 },
                desc.pictures,
              )
            : props[k];
      d.properties = next;
      d.required = order;
    }
    // Every lead: a plain lead becomes an item; a nullable lead a nullable item.
    if ("lead" in (d.properties as J)) {
      const p = d.properties as J;
      const lead = p.lead as J;
      p.lead = Array.isArray(lead.anyOf) ? { anyOf: [ITEM, { type: "null" }] } : ITEM;
    }
  }
  return s;
}

/** The misconception slot on a base3 writer schema: nullable, first after design, before the flow. */
export function msSchema(base: J, desc: Record<string, string> = {}): J {
  const s = clone(base);
  const props = s.properties as J;
  const slot = withDesc(
    {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["belief", "correcting_example"],
          properties: {
            belief: withDesc({ type: "string" }, desc["misconception.belief"]),
            correcting_example: withDesc(
              { type: "string" },
              desc["misconception.correcting_example"],
            ),
          },
        },
        { type: "null" },
      ],
    },
    desc.misconception,
  );
  const next: J = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "flow") next.misconception = slot;
    next[k] = v;
  }
  s.properties = next;
  s.required = Object.keys(next);
  return s;
}

/**
 * A b3-r1t slide in the shape the rest of the harness reads (writer-only scoring; no renderer yet):
 * items to their text, the first tile as the slide's picture. main.json keeps the writer's own shape.
 */
export function flattenR1t(slide: J): J {
  const text = (x: unknown) =>
    x && typeof x === "object" && "text" in (x as J) ? String((x as J).text) : x;
  const out: J = { ...slide };
  if (Array.isArray(out.questions)) out.questions = out.questions.map(text);
  if (out.instruction !== undefined) out.instruction = text(out.instruction);
  if (out.lead !== undefined) out.lead = text(out.lead);
  if (Array.isArray(out.pictures)) {
    const { pictures, ...rest } = out;
    return { ...rest, picture: (pictures as unknown[])[0] ?? null };
  }
  return out;
}

if (import.meta.main) {
  // D19a: each structural arm on base3 (b3-*) and on base4 (b4-*, base4 = b3-r2); one wording slot per arm.
  for (const [arm, make, baseArm, out] of [
    ["r1t", r1tSchema, "base3", "b3-r1t"],
    ["ms", msSchema, "base3", "b3-ms"],
    ["r1t", r1tSchema, "base4", "b4-r1t"],
    ["ms", msSchema, "base4", "b4-ms"],
  ] as const) {
    // The prompt-engineer's descriptions go in only on the coordinator's go (`--with-wording`).
    const desc = process.argv.includes("--with-wording") ? descriptions(arm) : {};
    for (const st of STAGES) {
      const base = JSON.parse(
        readFileSync(`${AB}/prompts/${baseArm}/T/schema.${st}.json`, "utf8"),
      ) as J;
      const made = make(base, desc);
      writeFileSync(
        `${AB}/prompts/${out}/T/schema.${st}.json`,
        `${JSON.stringify(made, null, 1)}\n`,
      );
      console.log(
        out,
        st,
        JSON.stringify(made).length,
        `bytes (${baseArm}`,
        JSON.stringify(base).length,
        ")",
      );
    }
  }
}
