import { Outlet } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Kbd } from "@tj/ui";
import { useState } from "react";
import { LibraryShellContext } from "@/components/library-shell-context";
import { LibrarySidebar } from "@/components/library-sidebar";

export function LibraryLayout() {
  const [importOpen, setImportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <LibraryShellContext.Provider value={{ openImport: () => setImportOpen(true) }}>
      <div className="flex min-h-dvh bg-background">
        <LibrarySidebar
          onImport={() => setImportOpen(true)}
          onShortcuts={() => setShortcutsOpen(true)}
        />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Import</DialogTitle>
              <DialogDescription>Import arrives with the editor.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
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
    </LibraryShellContext.Provider>
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
