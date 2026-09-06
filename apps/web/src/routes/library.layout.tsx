import { Outlet, useRouterState } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Kbd } from "@tj/ui";
import { useEffect, useState } from "react";
import { LibrarySidebar } from "@/components/library-sidebar";
import { rememberShell } from "@/lib/last-shell";

export function LibraryLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    rememberShell(pathname);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh bg-background">
      <LibrarySidebar onShortcuts={() => setShortcutsOpen(true)} />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Shortcuts available across the library shell.</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-3 text-sm">
            <Shortcut keys="/" label="Focus search" />
            <Shortcut keys="F2" label="Rename" />
            <Shortcut keys="⌘↑ / ⌘↓" label="Reorder in a series" />
            <Shortcut keys="Esc" label="Clear search" />
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt>{label}</dt>
      <dd>
        <Kbd>{keys}</Kbd>
      </dd>
    </div>
  );
}
