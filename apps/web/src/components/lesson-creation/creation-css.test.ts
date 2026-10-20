import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The phone's generation companion leaves without a layout shift (UX audit, CLS at 390 was 0.168
 * when the slot collapsed to height 0): the slot keeps its height and fades, and the slide list
 * rises over it by a transform, which the browser does not count as a shift.
 */
const css = readFileSync(resolve(__dirname, "creation.css"), "utf8");
const FINISHED =
  '.creation-editor-preview[data-story-finished="true"] [data-editor-companion="mobile"]';

function rulesFor(selector: string): string[] {
  const out: string[] = [];
  let at = css.indexOf(`${selector} {`);
  while (at !== -1) {
    const open = css.indexOf("{", at);
    out.push(css.slice(open + 1, css.indexOf("}", open)));
    at = css.indexOf(`${selector} {`, open);
  }
  return out;
}

describe("phone companion exit", () => {
  test("the finished slot fades in place and never collapses its height", () => {
    const slot = rulesFor(FINISHED);
    expect(slot.length).toBeGreaterThan(0);
    for (const body of slot) expect(body).not.toMatch(/height:\s*0/);
    expect(slot.join("\n")).toMatch(/opacity:\s*0/);
  });

  test("the slide list rises by a transform and grows at its foot by the same amount", () => {
    const list = rulesFor(`${FINISHED} + *`).join("\n");
    expect(list).toMatch(/transform:\s*translateY\(calc\(-1 \* var\(--companion-slot, 152px\)\)\)/);
    expect(list).toMatch(/margin-bottom:\s*calc\(-1 \* var\(--companion-slot, 152px\)\)/);
  });

  test("the slot the list rises over is the phone companion's height", () => {
    expect(css).toMatch(
      /\[data-editor-companion="mobile"\]:has\(\.creation-generation-anchor\) \{\s*height: 152px;/,
    );
  });
});
