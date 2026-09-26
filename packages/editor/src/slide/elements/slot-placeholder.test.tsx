import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { getTheme } from "../../model/themes";
import { SlotPlaceholder } from "./SlotPlaceholder";

/* A photo brief or a diagram instruction runs to 400 characters: the box holds what fits. */
describe("a long brief in a slot placeholder", () => {
  const theme = getTheme("chalk");
  const text =
    `Photo: ${"Roman legionaries in formation with shields and armour, ".repeat(7)}`.slice(0, 400);

  test("is clamped to the lines the box holds, and shown whole on hover", () => {
    const { container } = render(
      <SlotPlaceholder kind="photo" theme={theme} height={200} text={text} />,
    );
    const box = container.querySelector("[data-slot-placeholder]") as HTMLElement;
    expect(box.title).toBe(text);
    const words = box.querySelector("span") as HTMLElement;
    expect(words.textContent).toBe(text);
    expect(words.style.overflow).toBe("hidden");
    const lines = Math.floor((200 - 56) / (theme.sizes.caption * 1.35));
    // The test DOM drops -webkit-line-clamp; the browser check is the PR screenshot.
    expect(words.dataset.lines).toBe(String(lines));
  });
});
