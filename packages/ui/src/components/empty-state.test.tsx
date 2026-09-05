import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders its stacked paper decoration as hidden from assistive technology", () => {
    const { container } = render(
      <EmptyState icon={<Inbox />} title="No lessons" body="Create your first lesson." stacked />,
    );

    expect(screen.getByRole("heading", { name: "No lessons" })).toBeInTheDocument();
    expect(container.querySelectorAll("span[aria-hidden='true']")).toHaveLength(2);
  });
});
