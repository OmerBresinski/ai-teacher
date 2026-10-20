import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { getTheme, THEMES } from "../model/themes";
import {
  cachedSampleCount,
  fontPair,
  groupThemes,
  paletteOf,
  suitsOf,
  themeSamples,
} from "./samples";
import { type PickerVariant, ThemePicker } from "./ThemePicker";

/*
 * The theme picker (Greg, decision 34): real slides per theme, its fonts, colours and who it suits;
 * filters; a larger preview on hover or focus; one radio group for the keyboard; lazy previews.
 */

type Observed = { el: Element; cb: IntersectionObserverCallback; io: IntersectionObserver };
let observed: Observed[] = [];
const realIO = globalThis.IntersectionObserver;

/** An observer the test drives: `reveal(id)` reports that theme's tile in view. */
function installObserver() {
  observed = [];
  globalThis.IntersectionObserver = class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      observed.push({ el, cb: this.cb, io: this as unknown as IntersectionObserver });
    }
    disconnect() {
      observed = observed.filter((o) => o.io !== (this as unknown as IntersectionObserver));
    }
    unobserve() {}
  } as unknown as typeof IntersectionObserver;
}
function reveal(themeId: string) {
  act(() => {
    for (const o of observed.filter((x) => x.el.getAttribute("data-theme-preview") === themeId))
      o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], o.io);
  });
}

beforeEach(installObserver);
afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = realIO;
});

function Harness({
  initial = "paper",
  variant,
  title = "Volcanoes",
}: {
  initial?: string;
  variant?: PickerVariant;
  title?: string;
}) {
  const [id, setId] = useState(initial);
  return (
    <>
      <output data-testid="picked">{id}</output>
      <ThemePicker selectedId={id} onPick={setId} title={title} variant={variant} />
    </>
  );
}

const picked = () => screen.getByTestId("picked").textContent;
const preview = (id: string) =>
  document.querySelector<HTMLElement>(`[data-theme-preview="${id}"]`) as HTMLElement;

describe("ThemePicker", () => {
  for (const variant of ["spotlight", "cards", "list"] as const) {
    test(`${variant}: sixteen radios, named and described, the chosen one checked`, () => {
      render(<Harness variant={variant} initial="splash" />);
      const radios = screen.getAllByRole("radio");
      const names = radios.map((r) => r.getAttribute("aria-label"));
      // The cards list by group; the others in the catalogue order.
      expect(variant === "cards" ? [...names].sort() : names).toEqual(
        variant === "cards" ? THEMES.map((t) => t.name).sort() : THEMES.map((t) => t.name),
      );
      expect(screen.getByRole("radio", { name: "Splash" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("radio", { name: "Ember" })).toHaveAccessibleDescription(
        /Dark and warm.*Fonts: .*Good for: Dark room/,
      );
      fireEvent.click(screen.getByRole("radio", { name: "Beacon" }));
      expect(picked()).toBe("beacon");
    });
  }

  test("a tile draws its slides only once it comes into view, with the slide renderer", () => {
    render(<Harness variant="cards" title="Volcanoes lazy" />);
    expect(preview("poster").dataset.ready).toBe("false");
    expect(preview("poster").querySelector("[data-slide-fluid]")).toBeNull();
    reveal("poster");
    expect(preview("poster").dataset.ready).toBe("true");
    // The cards show the theme's cover and a teaching slide, drawn by SlideView.
    expect(preview("poster").querySelectorAll("[data-slide-fluid]")).toHaveLength(2);
    expect(preview("poster").textContent).toContain("Volcanoes lazy");
    expect(preview("treehouse").dataset.ready).toBe("false");
  });

  test("a theme drawn once draws at once when the picker reopens", () => {
    const { unmount } = render(<Harness title="Reopen" />);
    reveal("studio");
    unmount();
    render(<Harness title="Reopen" />);
    expect(preview("studio").dataset.ready).toBe("true");
    expect(preview("calm").dataset.ready).toBe("false");
  });

  test("the large preview follows hover and focus, else shows the chosen theme", () => {
    render(<Harness initial="paper" />);
    const spot = () =>
      document.querySelector("[data-theme-spotlight]")?.getAttribute("data-theme-spotlight");
    expect(spot()).toBe("paper");
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "Treehouse" }));
    expect(spot()).toBe("treehouse");
    fireEvent.pointerLeave(screen.getByRole("radiogroup", { name: "Theme" }));
    expect(spot()).toBe("paper");
    fireEvent.focus(screen.getByRole("radio", { name: "Slate" }));
    expect(spot()).toBe("dark-slate");
    // The spotlight names the fonts and the colours.
    const shown = document.querySelector("[data-theme-spotlight]") as HTMLElement;
    expect(shown.textContent).toContain("Lexend");
    expect(shown.querySelectorAll("[data-slide-fluid]")).toHaveLength(2);
  });

  test("one tab stop; arrows, Home and End move and choose", () => {
    render(<Harness initial="poster" />);
    const tabbable = screen.getAllByRole("radio").filter((r) => r.tabIndex === 0);
    expect(tabbable.map((r) => r.getAttribute("aria-label"))).toEqual(["Poster"]);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    screen.getByRole("radio", { name: "Poster" }).focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(picked()).toBe("treehouse");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Treehouse" }));
    fireEvent.keyDown(group, { key: "End" });
    expect(picked()).toBe("dark-ember");
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(picked()).toBe("paper");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(picked()).toBe("dark-ember");
    fireEvent.keyDown(group, { key: "Home" });
    expect(picked()).toBe("paper");
  });

  test("filters by who a theme suits, with counts; the choice survives a filter", () => {
    render(<Harness initial="paper" />);
    const early = screen.getByRole("button", { name: /^Early learners/ });
    expect(early).toHaveTextContent("5");
    fireEvent.click(early);
    expect(early).toHaveAttribute("aria-pressed", "true");
    const names = screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual(
      THEMES.filter((t) => t.tags.includes("early-learners")).map((t) => t.name),
    );
    // Paper is filtered out but stays chosen; the first shown tile takes the tab stop.
    expect(picked()).toBe("paper");
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByRole("radio")).toHaveLength(16);
  });

  test("the cards group every theme once: younger classes, dark room, calm and accessible, everyday", () => {
    render(<Harness variant="cards" />);
    const groups = screen.getAllByRole("group").filter((g) => g.getAttribute("aria-label"));
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "For younger classes",
      "For a dark room",
      "Calm and accessible",
      "Everyday",
    ]);
    const all = groupThemes(THEMES).flatMap((g) => g.themes.map((t) => t.id));
    expect([...all].sort()).toEqual(THEMES.map((t) => t.id).sort());
  });
});

describe("theme samples", () => {
  test("each theme's own cover, teaching slide and question, built once and cached", () => {
    const before = cachedSampleCount();
    const a = themeSamples("treehouse", "Cache check");
    expect(themeSamples("treehouse", "Cache check")).toBe(a);
    expect(cachedSampleCount()).toBe(before + 1);
    expect(a.cover.kind).toBe("title");
    expect(a.content.kind).toBe("starter");
    expect(a.theme.id).toBe("treehouse");
    expect(themeSamples("poster", "Cache check").cover).not.toBe(a.cover);
  });

  test("fonts, palette and who it suits read from the theme", () => {
    expect(fontPair(getTheme("splash")).label).toBe("Fredoka and Nunito");
    expect(fontPair(getTheme("paper")).label).toBe("Lexend");
    const palette = paletteOf(getTheme("paper"));
    expect(new Set(palette.map((c) => c.value.toLowerCase())).size).toBe(palette.length);
    expect(palette[0]?.name).toBe("Background");
    expect(suitsOf(getTheme("playground")).who).toBe("Reception and KS1");
  });
});
