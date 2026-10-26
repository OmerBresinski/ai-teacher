import { useRouterState } from "@tanstack/react-router";
import { RoutePendingPage } from "@/components/route-pending-page";

/** `/l/<id>` only: the lesson editor itself, not its viewer, present or print pages. */
const LESSON_EDITOR = /^\/l\/[^/]+\/?$/;
const LESSON_INTAKE = /^\/lessons\/new\/?$/;

function Loading() {
  return (
    <span className="sr-only" role="status">
      Loading…
    </span>
  );
}

/**
 * The lesson editor's frame with nothing in it yet: its bar and its page colour. Shown while a
 * cold load (a reload, a pasted link) waits for the session, the lesson or the editor's chunk, so
 * the editor fills in where it will stand instead of replacing a card in the middle of the screen.
 */
export function EditorShellPending() {
  return (
    <div className="flex h-dvh flex-col bg-background" aria-busy="true" data-shell-pending="editor">
      <Loading />
      <div className="h-(--topbar-height) shrink-0 border-b border-border bg-card" />
    </div>
  );
}

/** The lesson intake's page colour and brand line, while the intake's chunk or session loads. */
export function CreationShellPending() {
  return (
    <main className="min-h-dvh bg-background" aria-busy="true" data-shell-pending="creation">
      <Loading />
    </main>
  );
}

/**
 * The guest layout's pending view (the brief and a lesson's pages, TEACH-244): the shell of the
 * page being opened when it has one, else the router's generic `RoutePendingPage`.
 */
export function GuestPendingPage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (LESSON_EDITOR.test(pathname)) return <EditorShellPending />;
  if (LESSON_INTAKE.test(pathname)) return <CreationShellPending />;
  return <RoutePendingPage />;
}
