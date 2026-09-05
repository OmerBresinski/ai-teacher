import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { ListSurface, ListSurfaceCell, ListSurfaceHeader, ListSurfaceRow } from "./list-surface";

describe("ListSurface", () => {
  it("uses native table semantics for headers, rows, and cells", () => {
    render(
      <ListSurface
        aria-label="Lessons"
        header={
          <ListSurfaceHeader>
            <ListSurfaceCell header>Name</ListSurfaceCell>
          </ListSurfaceHeader>
        }
      >
        <ListSurfaceRow>
          <ListSurfaceCell>Photosynthesis</ListSurfaceCell>
        </ListSurfaceRow>
      </ListSurface>,
    );

    expect(screen.getByRole("table", { name: "Lessons" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Photosynthesis" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "Photosynthesis" })).toHaveClass("h-14", "group/row");
  });
});
