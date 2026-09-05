import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SearchInput } from "./search-input";

describe("SearchInput", () => {
  it("clears and blurs on Escape", async () => {
    const user = userEvent.setup();
    const onClear = mock();
    render(
      <SearchInput
        label="Search lessons"
        placeholder="Search"
        value="plants"
        onChange={mock()}
        onClear={onClear}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Search lessons" });
    input.focus();
    await user.keyboard("{Escape}");

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(input).not.toHaveFocus();
  });
});
