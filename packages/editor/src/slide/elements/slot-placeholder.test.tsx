import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { NO_PROPOSALS, ProposalsContext } from "../../lesson/proposals-context";
import { getTheme } from "../../model/themes";
import { isJobPictureSlot, PendingSheen, SlotPlaceholder } from "./SlotPlaceholder";

/* A photo brief or a diagram instruction runs to 400 characters: the box holds what fits. */
describe("a long brief in a slot placeholder", () => {
  const theme = getTheme("splash");
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

/* TEACH-202 part o: a picture the job is still adding shows it is on its way. */
describe("a picture on its way", () => {
  test("only the job's own slots, never a blank picture box the teacher added", () => {
    expect(isJobPictureSlot({ src: PLACEHOLDER_IMAGE, alt: "A frog on a lily pad" })).toBe(true);
    expect(
      isJobPictureSlot({
        src: PLACEHOLDER_IMAGE,
        alt: "Describe this image for pupils using a screen reader",
      }),
    ).toBe(false);
    expect(isJobPictureSlot({ src: "https://images.test/frog.jpg", alt: "A frog" })).toBe(false);
  });

  const withReducedMotion = (reduced: boolean, run: () => void) => {
    const was = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: reduced && q.includes("reduce"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      run();
    } finally {
      window.matchMedia = was;
    }
  };
  const coming = { ...NO_PROPOSALS, writingSlideIds: new Set<string>() };

  test("with reduced motion it says so, still, while the job runs", () =>
    withReducedMotion(true, () => {
      const { container } = render(
        <ProposalsContext.Provider value={coming}>
          <PendingSheen theme={getTheme("splash")} />
        </ProposalsContext.Provider>,
      );
      const cue = container.querySelector("[data-slot-sheen=still]");
      expect(cue?.textContent).toBe("Adding picture…");
    }));

  test("the dots and the moving light are drawn in the lesson theme's tokens (part av)", () =>
    withReducedMotion(false, () => {
      const theme = getTheme("splash");
      const { container } = render(
        <ProposalsContext.Provider value={coming}>
          <PendingSheen theme={theme} />
        </ProposalsContext.Provider>,
      );
      const field = container.querySelector("[data-slot-sheen]") as HTMLElement;
      const lit = container.querySelector("[data-slot-light] > div") as HTMLElement;
      expect(field.getAttribute("style")).not.toContain("255,255,255");
      expect(field.innerHTML).toContain(theme.colors.muted);
      expect(lit.getAttribute("style")).toContain(theme.colors.accent);
      expect(lit.getAttribute("style")).toContain("radial-gradient");
    }));

  test("Present and the viewer draw a slot still pending when they loaded, without the job", () =>
    withReducedMotion(false, () => {
      for (const mode of ["present", "view"] as const) {
        const { container, unmount } = render(
          <PendingSheen theme={getTheme("crayon")} mode={mode} />,
        );
        expect(container.querySelector("[data-slot-light]")).toBeTruthy();
        unmount();
      }
    }));

  test("in the rail, reduced motion keeps the still dots but not the words", () =>
    withReducedMotion(true, () => {
      const { container } = render(
        <ProposalsContext.Provider value={coming}>
          <PendingSheen theme={getTheme("exam-hall")} mode="thumb" />
        </ProposalsContext.Provider>,
      );
      expect(container.querySelector("[data-slot-sheen=still]")).toBeTruthy();
      expect(container.textContent).toBe("");
    }));

  test("once the job has ended there is no cue", () =>
    withReducedMotion(true, () => {
      const { container } = render(<PendingSheen theme={getTheme("splash")} />);
      expect(container.querySelector("[data-slot-sheen]")).toBeNull();
    }));
});
