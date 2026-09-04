import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { emitMatchMediaChange, setMatchMedia } from "../../bun-test.setup";
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from "./theme";
import { createThemeInitScript, THEME_INIT_SCRIPT } from "./theme-init";
import { ThemeProvider, useTheme } from "./theme-provider";

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <output data-testid="theme">{theme}</output>
      <output data-testid="resolved">{resolvedTheme}</output>
      {(["light", "dark", "high-contrast", "system"] as const).map((t: Theme) => (
        <button key={t} type="button" onClick={() => setTheme(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

const html = () => document.documentElement.dataset.theme;

describe("resolveTheme", () => {
  it("passes explicit themes through and derives system from OS preferences", () => {
    const prefs = { prefersDark: true, prefersMoreContrast: true };
    expect(resolveTheme("light", prefs)).toBe("light");
    expect(resolveTheme("dark", { prefersDark: false, prefersMoreContrast: false })).toBe("dark");
    expect(resolveTheme("high-contrast", { prefersDark: false, prefersMoreContrast: false })).toBe(
      "high-contrast",
    );
    expect(resolveTheme("system", { prefersDark: false, prefersMoreContrast: false })).toBe(
      "light",
    );
    expect(resolveTheme("system", { prefersDark: true, prefersMoreContrast: false })).toBe("dark");
    // prefers-contrast: more beats the colour scheme
    expect(resolveTheme("system", prefs)).toBe("high-contrast");
  });
});

describe("ThemeProvider", () => {
  it("with nothing stored and OS = dark, applies data-theme=dark", () => {
    setMatchMedia({ dark: true });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(html()).toBe("dark");
  });

  it("with nothing stored and OS = light, applies data-theme=light", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html()).toBe("light");
  });

  it("resolves prefers-contrast: more to high-contrast when following the system", () => {
    setMatchMedia({ dark: true, moreContrast: true });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html()).toBe("high-contrast");
  });

  it("setTheme('high-contrast') persists to localStorage and sets the attribute", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "high-contrast" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("high-contrast");
    expect(html()).toBe("high-contrast");
    expect(screen.getByTestId("theme")).toHaveTextContent("high-contrast");
    expect(screen.getByTestId("resolved")).toHaveTextContent("high-contrast");
  });

  it("a stored value wins over the OS preference", () => {
    setMatchMedia({ dark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(html()).toBe("light");
  });

  it("ignores garbage in storage and falls back to defaultTheme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    render(
      <ThemeProvider defaultTheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(html()).toBe("dark");
  });

  it("follows live OS changes while in system mode, and stops once explicit", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html()).toBe("light");

    act(() => {
      setMatchMedia({ dark: true });
      emitMatchMediaChange();
    });
    expect(html()).toBe("dark");

    await user.click(screen.getByRole("button", { name: "light" }));
    act(() => {
      setMatchMedia({ dark: false });
      emitMatchMediaChange();
      setMatchMedia({ dark: true });
      emitMatchMediaChange();
    });
    expect(html()).toBe("light");
  });

  it("honours a custom storageKey", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider storageKey="custom-key">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(window.localStorage.getItem("custom-key")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("mirrors changes from other tabs (storage event)", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "high-contrast" }),
      );
    });
    expect(html()).toBe("high-contrast");
  });

  it("useTheme throws outside a provider", () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});

describe("THEME_INIT_SCRIPT", () => {
  // Execute the generated script text in the test global scope (where happy-dom's window/document,
  // the matchMedia mock and localStorage live) — the same environment a real <script> would see.
  const run = (script: string) => {
    new Function(script)();
  };

  it("applies the stored theme before React runs", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "high-contrast");
    run(THEME_INIT_SCRIPT);
    expect(html()).toBe("high-contrast");
  });

  it("resolves the OS preference when nothing is stored", () => {
    setMatchMedia({ dark: true });
    run(THEME_INIT_SCRIPT);
    expect(html()).toBe("dark");

    setMatchMedia({ dark: true, moreContrast: true });
    run(THEME_INIT_SCRIPT);
    expect(html()).toBe("high-contrast");
  });

  it("ignores a stored 'system' or invalid value and resolves from the OS", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    run(THEME_INIT_SCRIPT);
    expect(html()).toBe("light");
  });

  it("supports a custom storage key and never throws", () => {
    window.localStorage.setItem("other", "dark");
    run(createThemeInitScript("other"));
    expect(html()).toBe("dark");

    const broken = createThemeInitScript("x").replace("window.localStorage", "undefinedThing");
    expect(() => run(broken)).not.toThrow();
  });
});
