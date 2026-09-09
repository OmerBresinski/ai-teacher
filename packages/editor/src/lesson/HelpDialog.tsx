import { Dialog, DialogContent, DialogHeader, DialogTitle, Kbd } from "@tj/ui";
import { formatShortcut } from "./keys";
import { ALL_SHORTCUTS, HELP_GROUP_NOTES, HELP_GROUPS, type HelpShortcut } from "./shortcuts";

// `duplicate` (element duplicate, Edit group) reads as a bare "Duplicate" next to Slides'
// "Duplicate slide"; relabel it for display only so the sheet disambiguates the two ⌘D's.
const LABEL_OVERRIDES: Partial<Record<string, string>> = {
  duplicate: "Duplicate element",
};

/**
 * The `?` sheet (TeachDeck `components/v2/editor/HelpDialog.tsx`), generated from the key maps.
 * The lesson editor's maps by default; the worksheet editor passes its own (`worksheet/shortcuts.ts`).
 */
export function HelpDialog({
  open,
  onClose,
  shortcuts = ALL_SHORTCUTS,
  groups = HELP_GROUPS,
  notes = HELP_GROUP_NOTES,
}: {
  open: boolean;
  onClose: () => void;
  shortcuts?: readonly HelpShortcut[];
  groups?: readonly string[];
  notes?: Partial<Record<string, string>>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {groups.map((group) => {
            const items = shortcuts.filter((s) => s.group === group);
            if (items.length === 0) return null;
            const note = notes[group];
            return (
              <section key={group} className="flex flex-col gap-1">
                <h3 className="m-0 font-semibold text-eyebrow text-ink-3 uppercase tracking-[0.08em]">
                  {group}
                </h3>
                {note ? <p className="-mt-0.5 m-0 text-eyebrow text-ink-3">{note}</p> : null}
                <dl className="m-0 flex flex-col">
                  {items.map((s) => (
                    <div key={s.id} className="flex min-h-8 items-center justify-between gap-3">
                      <dt className="text-body text-ink-2">{LABEL_OVERRIDES[s.id] ?? s.label}</dt>
                      <dd className="m-0 flex shrink-0 items-center gap-1">
                        {s.keys.slice(0, 2).map((k) => (
                          <Kbd key={k}>{formatShortcut(k).join("")}</Kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
