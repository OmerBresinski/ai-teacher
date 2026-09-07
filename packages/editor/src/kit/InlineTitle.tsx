import { IconButton, Input, useInlineRename } from "@tj/ui";
import { Pencil } from "lucide-react";

/*
 * The document title in an editor's top bar, renamed in place (TeachDeck `AppBarTitle onCommit`,
 * done with the shell's `useInlineRename` pattern): double-click, F2 or the pencil opens the
 * field; Enter or blur commits; Escape cancels. It is the page's `<h1>` — the static twin of the
 * title field, for the landmark outline. No `@tj/ui` twin: `AppBarTitle` is read-only and
 * `PageTitle` is the library's page heading.
 */

export type InlineTitleProps = {
  title: string;
  /** What the field and the pencil are called: "Lesson title" / "Rename lesson". */
  fieldLabel: string;
  renameLabel: string;
  onCommit: (title: string) => void;
};

export function InlineTitle({ title, fieldLabel, renameLabel, onCommit }: InlineTitleProps) {
  const rename = useInlineRename(title, { onCommit });
  if (rename.editing) {
    return (
      <Input
        aria-label={fieldLabel}
        className="h-8 w-64 font-semibold text-lead"
        {...rename.inputProps}
      />
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the heading is the rename target (double-click, F2), as in `PageTitle` */}
      <h1
        className="min-w-0 truncate font-semibold text-lead outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: F2 renames from the heading, as in `PageTitle`
        tabIndex={0}
        onDoubleClick={rename.start}
        onKeyDown={rename.onCardKeyDown}
      >
        {title}
      </h1>
      <IconButton label={renameLabel} size="sm" onClick={rename.start}>
        <Pencil aria-hidden size={14} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}
