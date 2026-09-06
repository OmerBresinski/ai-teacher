import type * as React from "react";
import { useRef, useState } from "react";

export type UseInlineRenameOptions = {
  onCommit: (title: string) => void;
  onDone?: () => void;
};

/** Shared inline rename interaction for page headings and library cards. */
function useInlineRename(initial: string, { onCommit, onDone }: UseInlineRenameOptions) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const cancelled = useRef(false);

  const done = () => {
    setEditing(false);
    onDone?.();
  };

  const commit = () => {
    if (!cancelled.current) {
      const title = draft.trim();
      if (title && title !== initial) onCommit(title);
    }
    done();
  };

  const start = () => {
    cancelled.current = false;
    setDraft(initial);
    setEditing(true);
  };

  return {
    editing,
    start,
    inputProps: {
      // The input mounts when editing starts, so `autoFocus` + select-on-focus replace an effect.
      autoFocus: true,
      onFocus: (event: React.FocusEvent<HTMLInputElement>) => event.currentTarget.select(),
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
      onBlur: commit,
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = true;
          done();
        }
      },
    },
    onCardKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "F2") {
        event.preventDefault();
        event.stopPropagation();
        start();
      }
    },
  };
}

export { useInlineRename };
