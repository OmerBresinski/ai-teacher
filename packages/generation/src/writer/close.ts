/*
 * Every lesson ends with its check (TEACH-110 part ab; rulings 141 and 148, as narrowed on 9-10
 * Oct). The exit ticket goes on the last slide, or, when a worksheet is made, on the worksheet,
 * with a closing slide that tells the class to complete it there.
 *
 * The writer's schema makes that last slide its own required field, `close`, after `slides`: the
 * writer cannot omit it, and an exit ticket can only be written there (it leaves the `slides`
 * menu). `slides` gives up one place to it, so the lesson's length is unchanged. The context's
 * setting picks the shape: an exit ticket, or the closing slide (a discussion slide, no picture).
 *
 * After the write, `closedSlides` puts `close` back at the end of `slides`, so everything
 * downstream sees the deck as before, and guards it: a lesson whose exit ticket belongs on the
 * slides and has none fails the job. Code cannot write an exit ticket (its questions check this
 * lesson's objectives), so there is no deterministic repair, and a lesson without its check must
 * never be stored as a success.
 */

type J = Record<string, unknown>;
type S = Record<string, unknown>;

export const EXIT_TICKET = "exit-ticket";
/** The closing slide's own def: a discussion slide (materialise lays it) with no picture. */
export const CLOSING_DEF = "worksheet-close";

const nameOf = (ref: J) =>
  String(ref.$ref ?? "")
    .split("/")
    .pop() ?? "";
const isExit = (ref: J) => nameOf(ref).split("~")[0] === EXIT_TICKET;

const CLOSE_ON_SLIDES =
  "The lesson's last slide, after every slide in slides: the exit ticket. The flow's last entry plans it.";
const CLOSE_ON_WORKSHEET =
  "The lesson's last slide, after every slide in slides: tells the class to complete the exit ticket on the worksheet, in a heading and one short line. The flow's last entry plans it.";

/** The writer's schema with the required `close` field (the lesson's last slide) after `slides`. */
export function withClose(schema: J, exitTicketOnSlides: boolean): J {
  const out = structuredClone(schema) as J;
  const props = out.properties as Record<string, J>;
  const defs = out.$defs as Record<string, J>;
  const slides = props.slides as J;
  const items = slides.items as { anyOf: J[] };
  const exits = items.anyOf.filter(isExit);
  if (exitTicketOnSlides && exits.length === 0)
    throw new Error("writer schema: no exit-ticket layout to close the lesson with");
  let close: J;
  if (exitTicketOnSlides) {
    close = { anyOf: exits, description: CLOSE_ON_SLIDES };
  } else {
    defs[CLOSING_DEF] = {
      type: "object",
      additionalProperties: false,
      required: ["template", "heading", "lead", "picture"],
      properties: {
        template: { type: "string", enum: ["discussion"] },
        heading: { type: "string" },
        lead: { type: "string" },
        picture: { type: "null" },
      },
    };
    close = { anyOf: [{ $ref: `#/$defs/${CLOSING_DEF}` }], description: CLOSE_ON_WORKSHEET };
  }
  const rest = items.anyOf.filter((r) => !isExit(r));
  const shrink = (n: unknown) => (typeof n === "number" ? Math.max(0, n - 1) : n);
  props.slides = {
    ...slides,
    items: { ...items, anyOf: rest },
    ...(slides.minItems !== undefined ? { minItems: shrink(slides.minItems) } : {}),
    ...(slides.maxItems !== undefined ? { maxItems: shrink(slides.maxItems) } : {}),
  };
  // `close` straight after `slides`, keeping every other field's order.
  const ordered: Record<string, J> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "close") continue;
    ordered[k] = v;
    if (k === "slides") ordered.close = close;
  }
  out.properties = ordered;
  out.required = Object.keys(ordered);
  return out;
}

/**
 * The written slides with `close` back at the end, and the guard: `missing` says why the lesson
 * must not be stored (an exit ticket that belongs on the slides and is on none of them), and
 * `note` says when a worksheet lesson came without its closing slide (an output from before
 * `close`, as a replay; the worksheet still holds the exit ticket, so it ships, logged).
 */
export function closedSlides(
  out: { slides?: S[]; close?: S | null },
  exitTicketOnSlides: boolean,
): { slides: S[]; missing?: string; note?: string } {
  const slides = [...(out.slides ?? []), ...(out.close ? [out.close] : [])];
  if (exitTicketOnSlides) {
    const has = slides.some((s) => String(s.template ?? "").split("~")[0] === EXIT_TICKET);
    return has
      ? { slides }
      : { slides, missing: "no exit ticket: the lesson must end with its check" };
  }
  return out.close
    ? { slides }
    : { slides, note: "no closing slide for the worksheet's exit ticket" };
}
