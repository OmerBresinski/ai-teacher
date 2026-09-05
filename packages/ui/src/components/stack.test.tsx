import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { Stack } from "./stack";

describe("Stack", () => {
  it("fans up to two back sheets around a 16:9 front sheet", () => {
    const { container } = render(
      <Stack
        width={196}
        sheets={[
          <span key="front">front</span>,
          <span key="near">near</span>,
          <span key="far">far</span>,
        ]}
      />,
    );
    const sheets = container.querySelectorAll(".bg-card");

    expect(sheets).toHaveLength(3);
    expect(sheets[0]?.getAttribute("style")).toContain("width: 176px");
    expect(sheets[0]?.getAttribute("style")).toContain("rotate(-4deg) translate(-14px, -26px)");
    expect(sheets[1]?.getAttribute("style")).toContain("width: 176px");
    expect(sheets[1]?.getAttribute("style")).toContain("rotate(3.5deg) translate(14px, -17px)");
    expect(container.firstElementChild?.getAttribute("style")).toContain("width: 196px");
    expect(container.firstElementChild?.getAttribute("style")).toContain("height: 110px");
    expect(sheets[2]?.getAttribute("style")).toContain("z-index: 3");
  });
});
