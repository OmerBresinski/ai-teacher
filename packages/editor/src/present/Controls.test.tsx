import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Lesson, Slide } from "@tj/domain/documents";
import { codedSetSlide } from "@tj/domain/documents/fixtures";
import { TooltipProvider } from "@tj/ui";
import { demoLibrary } from "../model/starter";
import { PresentView } from "./PresentView";

/* TEACH-101: Present's control on a coded question set. */

afterEach(cleanup);

function present(first: Slide) {
  const l = demoLibrary()[0] as Lesson;
  l.slides.splice(0, 0, first);
  render(
    <TooltipProvider>
      <PresentView lesson={l} onExit={mock(() => {})} onProgress={mock(() => {})} />
    </TooltipProvider>,
  );
}

const status = () =>
  screen
    .getAllByRole("status")
    .map((el) => el.textContent)
    .join(" ");
const next = () => fireEvent.keyDown(window, { key: "ArrowRight" });

describe("Controls on a coded set", () => {
  it("row 2: the answers step reads Answer, one press reveals them all, the next moves on", () => {
    present(codedSetSlide());
    expect(status()).toContain("step 1 of 2");
    expect(screen.getByRole("button", { name: /^Answer/ })).toBeInTheDocument();
    next();
    expect(status()).toContain("answer shown");
    next();
    expect(status()).toContain("Slide 2 of");
  });

  it("row 5: stored without the question, the same step reads Reveal, as before", () => {
    present(codedSetSlide(undefined, { question: false }));
    expect(status()).toContain("step 1 of 2");
    expect(screen.getByRole("button", { name: /^Reveal/ })).toBeInTheDocument();
    next();
    expect(status()).toContain("step 2 of 2");
  });

  it("an answers box followed by a later step: that last step is not labelled Answer", () => {
    const slide = codedSetSlide();
    const later = {
      ...(slide.elements[1] as Slide["elements"][number]),
      id: "later",
      revealStep: 2,
    };
    present({ ...slide, elements: [...slide.elements, later] });
    expect(status()).toContain("step 1 of 3");
    next();
    expect(screen.getByRole("button", { name: /^Reveal/ })).toBeInTheDocument();
  });
});
