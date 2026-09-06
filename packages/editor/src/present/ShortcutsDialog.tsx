import { cn, Dialog, DialogContent, DialogHeader, DialogTitle, Kbd } from "@tj/ui";
import { PRESENT_SHORTCUT_GROUPS, PRESENT_SHORTCUTS } from "./shortcuts";
import { STAGE_SCOPE_CLASS } from "./stage-tokens";
import { usePresent } from "./use-present-session";

/**
 * The `?` sheet (TeachDeck `components/v2/present/ShortcutsDialog.tsx`): always reachable, never
 * buried in a menu, generated from the same list the key handler implements, and on the stage
 * palette — it opens over a slide in a room with the lights down.
 */
export function ShortcutsDialog() {
  const { state, dispatch } = usePresent();
  return (
    <Dialog
      open={state.shortcutsOpen}
      onOpenChange={(open) => dispatch({ type: "setShortcutsOpen", open })}
    >
      <DialogContent size="xl" className={STAGE_SCOPE_CLASS}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-5">
          {PRESENT_SHORTCUT_GROUPS.map((group) => (
            <section key={group}>
              <h3 className="mb-1.5 font-semibold text-eyebrow text-ink-3 uppercase">{group}</h3>
              <ul className="flex flex-col">
                {PRESENT_SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  // Every row is the height of a two-line cap group so the two columns stay in
                  // register; the cap group is capped at 40% so a four-key row breaks 2 + 2.
                  <li key={s.id} className="flex min-h-11 items-center justify-between gap-3">
                    <span className={cn("min-w-[45%] flex-1 text-body text-ink-2")}>{s.label}</span>
                    <span className="flex max-w-[40%] flex-wrap items-center justify-end gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
