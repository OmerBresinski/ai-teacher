// Live writing P4 (TEACH-202 part c): the slide the writer's stream is writing, as a best-effort
// draft, before its JSON closes. `peekPartial` closes a cut JSON prefix (the open string at the
// current position, then the open arrays and objects); `SlideDrafts` watches the stream parser and
// hands each slide's drafts over, the template first and then its words as they grow, throttled.
// Drafts are read-only and never feed the final parse, the laid slides, the checks or the costs.
import type { PartialJson, Path } from "./partial";
import { nonFatalSync } from "./services";

type Frame = {
  kind: "obj" | "arr";
  /** obj: "key" (after `{` or `,`), "colon" (after a key), "value" (after `:`), "after" (after a value). */
  state: "key" | "colon" | "value" | "after";
  /** Where the last key string of this object started. */
  keyStart: number;
  key?: string;
  index: number;
};

/** A cut JSON text closed as far as it goes, and the path of the string it cut (if any). */
export type Peeked = { value: unknown; open?: Path };

/** A trailing escape that is not whole yet: a lone `\`, or `\u` with fewer than four hex digits. */
const CUT_ESCAPE = /\\u[0-9a-fA-F]{0,3}$/;
/** A trailing high-surrogate escape whose low half has not arrived. */
const HIGH_ESCAPE = /\\u[dD][89abAB][0-9a-fA-F]{2}$/;

const pathOf = (stack: Frame[]): Path =>
  stack.slice(0, -1).map((f) => (f.kind === "obj" ? (f.key as string) : f.index));

/**
 * The value a cut JSON text (an object or array start, cut anywhere) holds so far. An open string
 * value keeps the characters that have arrived, never cut inside an escape or a surrogate pair; an
 * open key, a key with no value yet, or a half-written number or literal is left out. Returns
 * undefined when nothing parses (it never throws on bad input).
 */
export function peekPartial(text: string): Peeked | undefined {
  const stack: Frame[] = [];
  let inStr = false;
  let esc = false;
  let strStart = -1;
  let scalarStart = -1;
  let lastKey: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const top = stack[stack.length - 1];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') {
        inStr = false;
        if (top?.kind === "obj" && top.state === "key") {
          lastKey = nonFatalSync(
            () => JSON.parse(text.slice(strStart, i + 1)) as string,
            () => undefined,
          );
          top.state = "colon";
        } else if (top) top.state = "after";
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      strStart = i;
      if (top?.kind === "obj" && top.state === "key") top.keyStart = i;
      continue;
    }
    if (/\s/.test(ch)) {
      if (scalarStart >= 0 && top) {
        scalarStart = -1;
        top.state = "after";
      }
      continue;
    }
    if (ch === ":" && top?.kind === "obj") {
      top.state = "value";
      top.key = lastKey;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (top) top.state = "after";
      stack.push({
        kind: ch === "{" ? "obj" : "arr",
        state: ch === "{" ? "key" : "value",
        keyStart: -1,
        index: 0,
      });
      continue;
    }
    if (ch === "," || ch === "}" || ch === "]") {
      scalarStart = -1;
      if (ch === ",") {
        if (top) {
          top.state = top.kind === "obj" ? "key" : "value";
          if (top.kind === "arr") top.index++;
        }
        continue;
      }
      stack.pop();
      continue;
    }
    if (scalarStart < 0) scalarStart = i;
  }
  if (stack.length === 0) {
    return nonFatalSync(
      () => ({ value: JSON.parse(text) as unknown }),
      () => undefined,
    );
  }
  let cut = text;
  let open: Path | undefined;
  const top = stack[stack.length - 1] as Frame;
  // An open string: a key is dropped; a value keeps what has arrived, whole characters only.
  if (inStr) {
    if (top.kind === "obj" && top.state === "key") {
      cut = text.slice(0, strStart);
    } else {
      let body = text.slice(strStart);
      if (esc) body = body.slice(0, -1);
      body = body.replace(CUT_ESCAPE, "").replace(HIGH_ESCAPE, "");
      const last = body.charCodeAt(body.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) body = body.slice(0, -1);
      cut = `${text.slice(0, strStart)}${body}"`;
      open = [...pathOf(stack), top.kind === "obj" ? (top.key as string) : top.index];
      top.state = "after";
    }
  } else if (scalarStart >= 0) {
    // A number or literal still being written: left out until it ends.
    cut = text.slice(0, scalarStart);
    top.state = "value";
  }
  // A key with no value yet goes; then a dangling comma.
  if (top.kind === "obj" && (top.state === "colon" || top.state === "value") && top.keyStart >= 0)
    cut = cut.slice(0, top.keyStart);
  cut = cut.replace(/[\s,]*$/, "");
  const close = stack
    .map((f) => (f.kind === "obj" ? "}" : "]"))
    .reverse()
    .join("");
  return nonFatalSync(
    () => ({ value: JSON.parse(cut + close) as unknown, ...(open ? { open } : {}) }),
    () => undefined,
  );
}

/** A slide as the stream has it so far: its template, and the fields that have arrived. */
export type SlideDraft = {
  /** The slide's template (the schema's first key), whole: drafts start once it has closed. */
  template: string;
  /** Every other field so far; an open string is cut where the stream is. */
  fields: Record<string, unknown>;
};

export type DraftOptions = {
  /** At most one words draft per this many ms (the template draft is never held back). Default 200. */
  ms?: number;
  /** The clock; tests pass a fake one. */
  now?: () => number;
};

/**
 * Watches the stream parser after each delta and hands over the open slide's drafts: the first as
 * soon as its template closes, then one per `ms` at most while its words grow (an unchanged draft
 * is not sent again). Slide indices are the writer's: the title is 0, `slides[k]` is k + 2.
 */
export class SlideDrafts {
  private slide = -1;
  private last = "";
  private at = Number.NEGATIVE_INFINITY;
  private ms: number;
  private now: () => number;
  /** Drafts handed over, and the time spent peeking (for the overhead report). */
  readonly stats = { drafts: 0, peeks: 0, ms: 0 };

  constructor(
    private onDraft: (index: number, draft: SlideDraft) => void,
    o: DraftOptions = {},
  ) {
    this.ms = o.ms ?? 200;
    this.now = o.now ?? (() => performance.now());
  }

  /** The open slide, if the stream is inside one: its index and where its text starts. */
  private openSlide(p: PartialJson): { index: number; start: number } | undefined {
    const one = p.frameAt(1);
    if (one?.kind === "obj" && one.path.length === 1 && one.path[0] === "title")
      return { index: 0, start: one.start };
    const two = p.frameAt(2);
    if (two?.kind === "obj" && two.path[0] === "slides" && typeof two.path[1] === "number")
      return { index: two.path[1] + 2, start: two.start };
    return undefined;
  }

  update(p: PartialJson): void {
    const t0 = performance.now();
    const open = this.openSlide(p);
    if (!open) return;
    const fresh = open.index !== this.slide;
    if (fresh) {
      this.slide = open.index;
      this.last = "";
    }
    const now = this.now();
    // A slide whose template has been sent waits out the throttle before its next draft.
    if (this.last && now - this.at < this.ms) return;
    this.stats.peeks++;
    const peeked = peekPartial(p.text.slice(open.start));
    this.stats.ms += performance.now() - t0;
    const v = peeked?.value as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    const template = v.template;
    if (typeof template !== "string" || peeked?.open?.[0] === "template") return;
    const { template: _t, ...fields } = v;
    const key = JSON.stringify(fields);
    const sent = `${template}\n${key}`;
    if (sent === this.last) return;
    this.last = sent;
    this.at = now;
    this.stats.drafts++;
    this.onDraft(open.index, { template, fields });
  }
}
