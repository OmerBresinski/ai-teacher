import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { Worksheet } from "@tj/domain/documents";
import { lessonDigest } from "@tj/slides/worksheet/digest";
import { exitTicketBlocks } from "@tj/slides/worksheet/exit-sheet";
import { fixtureLesson, type WorksheetFixtureName } from "@tj/slides/worksheet/fixtures";
import { starterWorksheet } from "../model/worksheet-factories";
import { answerKey } from "./answers";
import { WorksheetPrint } from "./WorksheetPrint";

/*
 * T6 (worksheets plan v2 §2d): the Exit ticket sheet built from the recorded lessons' slides,
 * as the answer key prints it and as the print view renders it. No model call.
 */

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

afterEach(() => cleanup());

function exitSheet(name: WorksheetFixtureName): Worksheet {
  let n = 0;
  const built = exitTicketBlocks(lessonDigest(fixtureLesson(name)), () => `${name}-${++n}`);
  if (!built.ok) throw new Error(built.reason);
  return {
    ...starterWorksheet(`Exit ticket: ${name}`),
    blocks: built.blocks,
    includeAnswerKey: true,
  };
}

describe("Exit ticket sheet answer key", () => {
  test.each(["halves", "romans", "rivers"] as const)(
    "%s: every question has its answer",
    (name) => {
      const key = answerKey(exitSheet(name).blocks);
      expect(key.length).toBeGreaterThanOrEqual(2);
      for (const entry of key) {
        expect(entry.lines.join(" ").trim().length).toBeGreaterThan(0);
        expect(entry.lines.join(" ")).not.toContain("No answer recorded");
      }
      expect(key).toMatchSnapshot();
    },
  );
});

describe("Exit ticket sheet print view", () => {
  test("rivers: heading, three numbered questions and the answer key render", async () => {
    const { container } = render(<WorksheetPrint worksheet={exitSheet("rivers")} />);
    await settle();
    const page = container.querySelector(".ws-print-root")?.textContent ?? "";
    expect(page).toContain("Exit ticket");
    expect(page).toContain("How does hydraulic action weaken cracks in a river channel?");
    expect(page).toContain("How can erosion of neighbouring bends lead to an oxbow lake?");
    expect(page).toContain("Water flows more slowly there, so sediment is deposited.");
    expect(page).not.toContain("No answer recorded");
  });
});
