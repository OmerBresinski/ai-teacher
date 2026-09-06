import { Dialog, DialogContent, DialogHeader, DialogTitle, Kbd } from "@tj/ui";
import { formatShortcut } from "./keys";
import { ALL_SHORTCUTS, HELP_GROUP_NOTES, HELP_GROUPS } from "./shortcuts";

// `duplicate` (element duplicate, Edit group) reads as a bare "Duplicate" next to Slides'
// "Duplicate slide"; relabel it for display only so the sheet disambiguates the two ⌘D's.
const LABEL_OVERRIDES: Partial<Record<string, string>> = {
  duplicate: "Duplicate element",
};

/** The `?` sheet (TeachDeck `components/v2/editor/HelpDialog.tsx`), generated from the key maps. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-4">
          {HELP_GROUPS.map((group) => {
            const items = ALL_SHORTCUTS.filter((s) => s.group === group);
            if (items.length === 0) return null;
            const note = HELP_GROUP_NOTES[group];
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
