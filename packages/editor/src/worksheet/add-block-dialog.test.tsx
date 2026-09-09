import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@tj/ui";
import { DEMO_LESSON_FACTS } from "../model/demo-facts";
import { getTheme } from "../model/themes";
import { starterWorksheet } from "../model/worksheet-factories";
import { AddBlockDialog, type AddBlockDialogProps } from "./AddBlockDialog";

/*
 * The "Add a block" dialog on its own (TEACH-183): the nine cards with live miniatures built from
 * the facts, the chips, the Blocks tab, and the keyboard path: Tab to a card, Enter inserts,
 * Escape closes.
 */

afterEach(cleanup);

function renderDialog(overrides: Partial<AddBlockDialogProps> = {}) {
  const onPickRecipe = mock(() => {});
  const onPickBlock = mock(() => {});
  const onOpenChange = mock((_open: boolean) => {});
  const worksheet = starterWorksheet("The water cycle");
  render(
    <TooltipProvider>
      <AddBlockDialog
        open
        onOpenChange={onOpenChange}
        worksheet={worksheet}
        theme={getTheme(worksheet.themeId)}
        facts={DEMO_LESSON_FACTS}
        onPickRecipe={onPickRecipe}
        onPickBlock={onPickBlock}
        {...overrides}
      />
    </TooltipProvider>,
  );
  const dialog = screen.getByRole("dialog", { name: "Add a block" });
  return { dialog, onPickRecipe, onPickBlock, onOpenChange };
}

describe("AddBlockDialog", () => {
  test("without facts the miniatures still wear this sheet's own header (TEACH-184 item 6)", () => {
    const worksheet = starterWorksheet("Fractions practice");
    worksheet.header.subtitle = "I can find a fraction of an amount";
    const { dialog } = renderDialog({ worksheet, facts: undefined });
    const card = dialog.querySelector('[data-recipe="exit-ticket"]');
    if (!card) throw new Error("no exit ticket card");
    expect(card.querySelector(".ws-mini .ws-title")?.textContent).toBe("Fractions practice");
    expect(card.querySelector(".ws-mini .ws-objective")?.textContent).toBe(
      "I can find a fraction of an amount",
    );
    expect(dialog.textContent).not.toContain("The water cycle");
  });

  test("nine cards, each a real sheet in miniature built from the facts, with a minutes pill", () => {
    const { dialog } = renderDialog();
    const cards = within(dialog)
      .getByRole("list", { name: "Sections" })
      .querySelectorAll(":scope > li");
    expect(cards.length).toBe(9);
    const matching = dialog.querySelector('[data-recipe="matching"]');
    if (!matching) throw new Error("no matching card");
    // The miniature is the printed sheet: this sheet's title, then the six pairs.
    expect(matching.querySelector(".ws-mini .ws-title")?.textContent).toBe("The water cycle");
    expect(matching.querySelectorAll(".ws-mini .ws-match-blank").length).toBe(6);
    expect(within(matching as HTMLElement).getByText(/^about \d+ min$/)).toBeInTheDocument();
    expect(
      within(dialog).getByText("Sections are built from this lesson. Blocks are empty."),
    ).toBeInTheDocument();
  });

  test("without facts the miniatures carry the placeholder copy", () => {
    const { dialog } = renderDialog({ facts: undefined });
    const exam = dialog.querySelector('[data-recipe="exam-style"]');
    expect(exam?.textContent).toContain("Write a question on the topic");
    expect(within(dialog).getByText(/placeholder text to replace/)).toBeInTheDocument();
  });

  test("job chips filter; a second press clears", () => {
    const { dialog } = renderDialog();
    const cards = () =>
      within(dialog).getByRole("list", { name: "Sections" }).querySelectorAll(":scope > li");
    fireEvent.click(within(dialog).getByRole("button", { name: "Practise" }));
    expect(Array.from(cards()).map((c) => c.getAttribute("data-recipe"))).toEqual([
      "cloze",
      "matching",
      "worked-example",
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Starter" }));
    expect(Array.from(cards()).map((c) => c.getAttribute("data-recipe"))).toEqual([
      "misconception-check",
      "word-search",
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Starter" }));
    expect(cards().length).toBe(9);
  });

  test("keyboard: every card is a button; Enter picks it with its built blocks; Escape closes", () => {
    const { dialog, onPickRecipe, onOpenChange } = renderDialog();
    const buttons = within(dialog)
      .getAllByRole("button")
      .filter((b) => b.classList.contains("ws-recipe-pick"));
    expect(buttons.length).toBe(9);
    const exit = buttons[0] as HTMLButtonElement;
    expect(exit.getAttribute("aria-label")).toMatch(/^Exit ticket\. .*About 5 minutes\.$/);
    exit.focus();
    expect(document.activeElement).toBe(exit);
    fireEvent.click(exit); // what Enter does on a focused button
    expect(onPickRecipe).toHaveBeenCalledTimes(1);
    const [recipe, blocks] = onPickRecipe.mock.calls[0] as unknown as [
      { id: string },
      { type: string }[],
    ];
    expect(recipe.id).toBe("exit-ticket");
    expect(blocks.map((b) => b.type)).toEqual([
      "question",
      "question",
      "question",
      "answer-box",
      "paragraph",
    ]);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("Blocks tab: the fifteen block types with their descriptions; picking one calls back", async () => {
    const { dialog, onPickBlock } = renderDialog({ initialTab: "blocks" });
    const picks = within(dialog)
      .getAllByRole("button")
      .filter((b) => b.classList.contains("ws-block-pick"));
    expect(picks.length).toBe(16);
    expect(within(dialog).getByText("A letter grid with the words to find")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Word search/ }));
    expect(onPickBlock).toHaveBeenCalledTimes(1);
    expect((onPickBlock.mock.calls[0] as unknown as [{ id: string }])[0].id).toBe("word-search");
  });
});
