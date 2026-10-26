import { describe, expect, test } from "bun:test";
import { replayRun } from "./replay-fixture";

/*
 * TEACH-202 part o: when the writer's stream ends, the stage hears it once (`onWritten`) with
 * every slide it wrote, after each slide is laid and before the editable deck, so the last slide
 * stops reading "Writing this slide…" while pictures, checks and notes run on.
 */

const LESSON = "y1-science-animals-young";

describe("the writer's stream has ended", () => {
  test("onWritten comes once, after every slide is laid, before the deck is editable", async () => {
    const order: string[] = [];
    const laid = new Set<number>();
    let written: readonly number[] = [];
    await replayRun(LESSON, {
      hooks: {
        onSlide: (i) => {
          laid.add(i);
          order.push("slide");
        },
        onWritten: (indices) => {
          written = indices;
          order.push("written");
        },
        onEditable: async () => {
          order.push("editable");
        },
      },
    });
    expect(order.filter((o) => o === "written")).toHaveLength(1);
    expect(order.indexOf("written")).toBeLessThan(order.indexOf("editable"));
    // Every slide laid while the stream ran is among the written ones, in deck order, title first.
    expect(written[0]).toBe(0);
    expect(written).not.toContain(1);
    expect([...written].sort((a, b) => a - b)).toEqual([...written]);
    for (const i of laid) if (i !== 1) expect(written).toContain(i);
  });
});
