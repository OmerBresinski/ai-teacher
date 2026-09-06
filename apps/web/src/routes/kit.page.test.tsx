import { afterEach, describe, expect, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, TooltipProvider } from "@tj/ui";
import { KitPage } from "./kit.page";

function renderKit() {
  return render(
    <ThemeProvider defaultTheme="light">
      <TooltipProvider>
        <KitPage />
      </TooltipProvider>
    </ThemeProvider>,
  );
}

describe("KitPage", () => {
  afterEach(() => localStorage.clear());

  test("renders all gallery section headings and sets its document title", () => {
    renderKit();

    for (const section of [
      "Foundations",
      "Actions",
      "Text entry",
      "Choice",
      "Value",
      "Overlays",
      "Feedback",
      "Motion",
      "Chrome",
      "Content",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeVisible();
    }
    expect(document.title).toBe("Kit · Teaching Journey");
  });

  test("theme tabs update the shared theme", async () => {
    renderKit();
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    await user.click(screen.getByRole("tab", { name: "High contrast" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("high-contrast"));
  });
});
