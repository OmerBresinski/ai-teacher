import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useInlineRename } from "./use-inline-rename";

function RenameHarness({ onCommit }: { onCommit: (title: string) => void }) {
  const rename = useInlineRename("Lesson one", { onCommit });
  return rename.editing ? (
    <input aria-label="Title" {...rename.inputProps} />
  ) : (
    <button type="button" onDoubleClick={rename.start} onKeyDown={rename.onCardKeyDown}>
      Lesson one
    </button>
  );
}

describe("useInlineRename", () => {
  it("starts on F2 and commits on blur", async () => {
    const user = userEvent.setup();
    const onCommit = mock();
    render(<RenameHarness onCommit={onCommit} />);

    await user.click(screen.getByRole("button", { name: "Lesson one" }));
    await user.keyboard("{F2}");
    const input = screen.getByRole("textbox", { name: "Title" });
    await user.clear(input);
    await user.type(input, "Updated");
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith("Updated");
  });
});
