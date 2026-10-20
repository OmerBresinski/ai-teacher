import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { demoLibrary } from "../model/starter";
import { getTheme, THEMES } from "../model/themes";
import {
  blankCover,
  cachedSampleCount,
  coverWords,
  fontPair,
  lessonPicks,
  loadSampleKit,
  paletteOf,
  SAMPLE_LAYOUTS,
  setSamplePhotos,
  suitsOf,
  themeSamples,
} from "./samples";
import { ThemePicker } from "./ThemePicker";

/*
 * The theme picker (Greg, decisions 34 and 72-75, layout A): each theme's real slides (a cover
 * with a picture, then its visual layouts), its fonts and who it suits; filters; a larger preview
 * on hover or focus that says whose theme it shows; one radio group for the keyboard; lazy tiles.
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

const PHOTO = "https://example.test/chicks.jpg";

beforeAll(async () => {
  setSamplePhotos(() => PHOTO);
  await loadSampleKit();
});
beforeEach(installObserver);
afterEach(() => {
  cleanup();
  globalThis.IntersectionObserver = realIO;
});

function Harness({ initial = "paper", title = "Volcanoes" }: { initial?: string; title?: string }) {
  const [id, setId] = useState(initial);
  return (
    <>
      <output data-testid="picked">{id}</output>
      <ThemePicker selectedId={id} onPick={setId} title={title} subtitle="Year 5. Rocks" />
    </>
  );
}

const picked = () => screen.getByTestId("picked").textContent;
const preview = (id: string) =>
  document.querySelector<HTMLElement>(`[data-theme-preview="${id}"]`) as HTMLElement;
const spot = () => document.querySelector<HTMLElement>("[data-theme-spotlight]") as HTMLElement;

describe("ThemePicker", () => {
  test("sixteen radios in catalogue order, named and described, the chosen one checked", () => {
    render(<Harness initial="splash" />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(THEMES.map((t) => t.name));
    expect(screen.getByRole("radio", { name: "Splash" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Ember" })).toHaveAccessibleDescription(
      /Dark and warm.*Fonts: .*Good for: Dark room/,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Beacon" }));
    expect(picked()).toBe("beacon");
  });

  test("a tile draws once in view: the cover (its picture slot open) and a diagram, no colour dots", () => {
    render(<Harness title="Volcanoes lazy" />);
    expect(preview("poster").dataset.ready).toBe("false");
    expect(preview("poster").querySelector("[data-slide-fluid]")).toBeNull();
    reveal("poster");
    const tile = preview("poster");
    expect(tile.dataset.ready).toBe("true");
    expect(tile.querySelectorAll("[data-slide-fluid]")).toHaveLength(2);
    expect(tile.textContent).toContain("Volcanoes lazy");
    expect(tile.textContent).toContain("Year 5. Rocks");
    // The teacher's title is on the cover: no photo of another topic beside it.
    expect(tile.querySelector(`img[src="${PHOTO}"]`)).toBeNull();
    // Decision 72: no palette blobs on the tiles.
    expect(tile.querySelector("[data-palette]")).toBeNull();
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

  test("the large preview says whose theme it shows and follows hover and focus", () => {
    render(<Harness initial="splash" />);
    expect(spot().dataset.themeSpotlight).toBe("splash");
    expect(spot().dataset.spotlightState).toBe("chosen");
    expect(spot().textContent).toContain("Your theme");
    fireEvent.pointerEnter(screen.getByRole("radio", { name: "Treehouse" }));
    expect(spot().dataset.themeSpotlight).toBe("treehouse");
    expect(spot().textContent).toContain("Preview");
    fireEvent.pointerLeave(screen.getByRole("radiogroup", { name: "Theme" }));
    expect(spot().dataset.themeSpotlight).toBe("splash");
    fireEvent.focus(screen.getByRole("radio", { name: "Slate" }));
    expect(spot().dataset.themeSpotlight).toBe("dark-slate");
    // The cover and three visual layouts at full width, the fonts, one quiet row of swatches.
    expect(spot().querySelectorAll("[data-slide-fluid]")).toHaveLength(1 + SAMPLE_LAYOUTS.length);
    expect(spot().textContent).toContain("Lexend");
    expect(spot().querySelector("[data-palette]")?.textContent).toBe("");
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
    expect(picked()).toBe("paper");
    expect(screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByRole("radio")).toHaveLength(16);
  });
});

describe("theme samples", () => {
  test("the writer's own layouts per theme, built once and cached", () => {
    const before = cachedSampleCount();
    const a = themeSamples("treehouse", "Cache check");
    if (!a) throw new Error("kit not loaded");
    expect(themeSamples("treehouse", "Cache check")).toBe(a);
    expect(cachedSampleCount()).toBe(before + 1);
    expect(a.cover.kind).toBe("title");
    // One coherent sample lesson: a lamb picture, a life cycle diagram, a hinge on young animals.
    expect(a.layouts).toHaveLength(3);
    expect(a.layouts.some((s) => s.kind === "objectives" || s.kind === "starter")).toBe(false);
    const words = JSON.stringify(a.layouts);
    expect(words).toContain("Lambs and ewes");
    expect(words).toContain("egg to hen");
    expect(words).not.toContain("river");
    expect(JSON.stringify(a.cover)).not.toContain(PHOTO);
    expect(JSON.stringify(a.layouts[0])).toContain(PHOTO);
    expect(themeSamples("poster", "Cache check")?.cover).not.toBe(a.cover);
  });

  test("an open lesson's own slides: its cover, then its most visual slides in deck order", () => {
    const lesson = demoLibrary()[0];
    if (!lesson) throw new Error("no demo lesson");
    const picks = lessonPicks(lesson);
    expect(picks.cover.kind).toBe("title");
    expect(picks.layouts.length).toBeGreaterThan(0);
    expect(picks.layouts.length).toBeLessThanOrEqual(3);
    for (const s of [picks.visual, ...picks.layouts])
      expect(["title", "objectives", "starter", "exit-ticket"]).not.toContain(s.kind);
    const at = picks.layouts.map((s) => lesson.slides.indexOf(s));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(picks.layouts).toContain(picks.visual);
    // A deck with nothing visual falls back to its next slides.
    const plain = {
      ...lesson,
      slides: lesson.slides.filter((s) => s.kind === "title" || s.kind === "objectives"),
    };
    expect(lessonPicks(plain).visual.kind).toBe("objectives");
  });

  test("a blank lesson's cover keeps its picture slot open (the placeholder)", async () => {
    const cover = await blankCover("poster", "Volcanoes", "Year 4 · Science");
    expect(cover.kind).toBe("title");
    const pictures = cover.elements.filter((e) => e.type === "image");
    expect(pictures).toHaveLength(1);
    expect(JSON.stringify(cover)).not.toContain(PHOTO);
    expect(JSON.stringify(cover)).toContain("Volcanoes");
    expect(JSON.stringify(cover)).toContain("Year 4 · Science");
  });

  test("an existing lesson's previews carry its own cover words; none are invented", () => {
    const lesson = demoLibrary()[0];
    if (!lesson) throw new Error("no demo lesson");
    expect(coverWords(lesson)).toEqual({
      title: "The water cycle",
      subtitle: "Year 5. Where rain comes from",
    });
    const bare = { ...lesson, slides: [], yearGroup: "Year 2", subject: "History" };
    expect(coverWords(bare)).toEqual({ title: lesson.title, subtitle: "Year 2 · History" });
    expect(coverWords({ ...bare, yearGroup: undefined, subject: undefined }).subtitle).toBe("");
    const samples = themeSamples(
      "poster",
      "The water cycle",
      null,
      "Year 5. Where rain comes from",
    );
    expect(JSON.stringify(samples?.cover)).toContain("Year 5. Where rain comes from");
    expect(JSON.stringify(samples?.cover)).not.toContain("Year 4");
  });

  test("fonts, palette and who it suits read from the theme", () => {
    expect(fontPair(getTheme("splash")).label).toBe("Fredoka and Nunito");
    expect(fontPair(getTheme("paper")).label).toBe("Lexend");
    const palette = paletteOf(getTheme("paper"));
    expect(new Set(palette.map((c) => c.value.toLowerCase())).size).toBe(palette.length);
    expect(suitsOf(getTheme("playground")).who).toBe("Reception and KS1");
    expect(suitsOf(getTheme("calm")).who).toBe("Any age, for a calm room");
  });
});
