// The writer's stream parser (TEACH-110 part h, C1), byte for byte from the lab's
// `lab/bakeoff/partial.ts` (lab/ab-base4f) below this header, but for its one recovery, which goes
// through `nonFatalSync` (a budget or abort error is never swallowed).
// BAKEOFF harness: an incremental JSON scanner for a streamed structured output.
// Feed it text chunks; it calls `onValue(path, value)` each time a value at depth 1 (a top-level
// key's whole value) or depth 2 (one element of a top-level array, or one field of a top-level
// object) closes. Paths: ["flow"], ["slides", 3], ["objectives", 0].
import { nonFatalSync } from "./services";

export type Path = (string | number)[];

type Frame = {
  kind: "obj" | "arr";
  start: number;
  key?: string;
  index: number;
  pendingKey?: string;
};

export class PartialJson {
  private buf = "";
  private pos = 0;
  private stack: Frame[] = [];
  private inStr = false;
  private esc = false;
  private strStart = -1;
  private lastKey: string | undefined;
  private scalarStart = -1;

  constructor(private onValue: (path: Path, value: unknown) => void) {}

  get text(): string {
    return this.buf;
  }

  private pathOf(depth: number): Path {
    // The path of a value that sits inside stack[depth - 1].
    const out: Path = [];
    for (let i = 0; i < depth; i++) {
      const f = this.stack[i] as Frame;
      if (i === 0) continue;
      const parent = this.stack[i - 1] as Frame;
      out.push(parent.kind === "obj" ? (f.key as string) : parent.index);
    }
    return out;
  }

  private emit(start: number, end: number) {
    // A value just closed at stack depth `d` (the frame it sits in is stack[d-1]).
    const d = this.stack.length;
    if (d < 1 || d > 2) return;
    const parent = this.stack[d - 1] as Frame;
    const path = [
      ...this.pathOf(d),
      parent.kind === "obj" ? (parent.pendingKey as string) : parent.index,
    ];
    if (path.some((p) => p === undefined)) return;
    // The one change from the lab's file: a budget or abort error is never swallowed here.
    nonFatalSync(
      () => this.onValue(path, JSON.parse(this.buf.slice(start, end))),
      () => {
        /* incomplete or invalid: ignored */
      },
    );
  }

  push(chunk: string) {
    this.buf += chunk;
    const s = this.buf;
    for (; this.pos < s.length; this.pos++) {
      const ch = s[this.pos] as string;
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === "\\") this.esc = true;
        else if (ch === '"') {
          this.inStr = false;
          const top = this.stack[this.stack.length - 1];
          const raw = s.slice(this.strStart, this.pos + 1);
          // A string is a key when the next non-space character is ':'; decide lazily.
          this.lastKey = JSON.parse(raw) as string;
          this.scalarStart = this.strStart;
          if (top && top.kind === "arr") {
            this.emit(this.strStart, this.pos + 1);
            this.scalarStart = -1;
          }
        }
        continue;
      }
      if (ch === '"') {
        this.inStr = true;
        this.strStart = this.pos;
        continue;
      }
      const top = this.stack[this.stack.length - 1];
      if (ch === ":") {
        if (top) top.pendingKey = this.lastKey;
        this.scalarStart = -1;
        continue;
      }
      if (ch === "{" || ch === "[") {
        const key = top?.kind === "obj" ? top.pendingKey : undefined;
        this.stack.push({ kind: ch === "{" ? "obj" : "arr", start: this.pos, key, index: 0 });
        this.scalarStart = -1;
        continue;
      }
      if (ch === "}" || ch === "]" || ch === ",") {
        // A scalar (string, number, true, false, null) value ends here.
        if (this.scalarStart >= 0 && top) {
          const isValue =
            top.kind === "arr" || (top.kind === "obj" && top.pendingKey !== undefined);
          if (isValue) this.emit(this.scalarStart, this.pos);
        }
        this.scalarStart = -1;
        if (ch === ",") {
          if (top?.kind === "arr") top.index++;
          if (top?.kind === "obj") top.pendingKey = undefined;
          continue;
        }
        const closed = this.stack.pop() as Frame;
        this.emit(closed.start, this.pos + 1);
        continue;
      }
      if (!/\s/.test(ch) && this.scalarStart < 0) this.scalarStart = this.pos;
    }
  }
}
