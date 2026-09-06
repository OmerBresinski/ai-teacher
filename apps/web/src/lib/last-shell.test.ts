import { afterEach, describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { rememberShell, useShellReturn } from "./last-shell";

function ShellReturn() {
  return createElement("output", null, useShellReturn());
}

describe("last shell", () => {
  afterEach(() => sessionStorage.clear());

  it("remembers valid library paths for editor return", () => {
    rememberShell("/series/series-romans");
    render(createElement(ShellReturn));

    expect(screen.getByText("/series/series-romans")).toBeVisible();
  });

  it("does not replace a shell return with an editor path", () => {
    rememberShell("/lessons");
    rememberShell("/l/demo-water-cycle");
    render(createElement(ShellReturn));

    expect(screen.getByText("/lessons")).toBeVisible();
  });

  it("notifies an already mounted editor stub when the shell changes", async () => {
    render(createElement(ShellReturn));
    await act(async () => {
      rememberShell("/worksheets");
    });

    expect(screen.getByText("/worksheets")).toBeVisible();
  });
});
