/**
 * The picture behind the magic-link confirm sheet (UX ruling 126, TEACH-214): where the teacher is
 * going, drawn as a skeleton from the link alone. Nothing here fetches, and nothing is private: the
 * app's own chrome and words, grey blocks where the teacher's lessons will be, and the topic the
 * teacher typed on the homepage. `RoutePendingPage` paints the same picture while the destination
 * loads after the api redirect, so the sheet lifts off a page that stays put.
 *
 * Decoration only: the caller hides it from assistive technology and makes it inert.
 */
import { FileText, Layers, Presentation } from "lucide-react";
import type { ReactNode } from "react";
import type { ConfirmDestination } from "@/lib/confirm-destination";

const ICON = { size: 16, strokeWidth: 1.5 } as const;

function Block({ className }: { className: string }) {
  return <span className={`block rounded-md bg-muted ${className}`} />;
}

/** The library sidebar at rest: wordmark and four rows, icons only below `md` (as the real one). */
function SidebarSkeleton() {
  return (
    <div className="flex w-16 shrink-0 flex-col gap-2 border-r border-border px-3 pt-6 md:w-[220px]">
      <span className="mb-4 px-1 text-[22px] leading-none font-[750] tracking-[-0.04em] text-foreground">
        <span className="md:hidden">D</span>
        <span className="hidden md:inline">DayBack</span>
      </span>
      {[0, 1, 2, 3].map((row) => (
        <span
          key={row}
          className={`flex h-8 items-center gap-2 rounded-lg px-2 ${row === 0 ? "bg-muted" : ""}`}
        >
          <Block className="size-4 shrink-0 rounded" />
          <Block className="hidden h-3 w-20 md:block" />
        </span>
      ))}
    </div>
  );
}

function Tile({ icon, label, primary }: { icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <span
      className={`flex h-16 items-center gap-4 rounded-xl px-5 text-[15px] font-semibold ${
        primary
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-foreground"
      }`}
    >
      <span
        className={`grid size-10 place-items-center rounded-lg ${primary ? "bg-white/15" : "bg-muted"}`}
      >
        {icon}
      </span>
      {label}
    </span>
  );
}

function CardSkeleton() {
  return (
    <span className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <Block className="aspect-video w-full rounded-none" />
      <span className="flex flex-col gap-2 p-4">
        <Block className="h-3.5 w-3/4" />
        <Block className="h-3 w-1/3" />
      </span>
    </span>
  );
}

/** The lessons dashboard (`/`): sidebar, "Home", the three create tiles and a grid of cards. */
function DashboardSkeleton() {
  return (
    <div className="flex min-h-full">
      <SidebarSkeleton />
      <div className="min-w-0 flex-1 px-6 pt-8 md:px-12">
        <p className="text-[32px] leading-none font-[750] tracking-[-0.03em] text-foreground">
          Home
        </p>
        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr_1fr]">
          <Tile primary label="New lesson" icon={<Presentation {...ICON} />} />
          <Tile label="New worksheet" icon={<FileText {...ICON} />} />
          <Tile label="New series" icon={<Layers {...ICON} />} />
        </div>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((card) => (
            <CardSkeleton key={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The brief step of `/lessons/new` with the teacher's topic in the Topic box. */
function NewLessonSkeleton({ topic }: { topic: string }) {
  return (
    <div className="px-5 pt-7 sm:px-[clamp(20px,5vw,72px)]">
      <p className="mx-auto max-w-[1320px] text-[30px] leading-none font-[750] tracking-[-0.06em] text-foreground">
        dayback<span className="text-muted-foreground">.</span>
      </p>
      <div className="mx-auto mt-[clamp(44px,8vh,104px)] grid max-w-[868px] gap-12 md:translate-x-[clamp(-114px,calc((1100px-100vw)/2),0px)] md:grid-cols-[180px_minmax(0,640px)]">
        <span className="hidden aspect-square w-[120px] self-start justify-self-center rounded-[28px] bg-muted md:block" />
        <div className="flex min-w-0 flex-col gap-8">
          <p className="text-[clamp(2rem,4vw,2.75rem)] leading-[1.05] font-[750] tracking-[-0.04em] text-foreground">
            Let’s start with your idea.
          </p>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-foreground">Topic</span>
            <span className="block min-h-24 rounded-lg border border-input bg-card px-3 py-2.5 text-body break-words text-foreground">
              {topic}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-foreground">Year group</span>
            <span className="block h-12 rounded-lg border border-input bg-card" />
          </div>
          <span className="block h-12 w-28 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

/** Any other destination: the app's frame with nothing in it yet. */
function ShellSkeleton() {
  return (
    <div className="flex min-h-full">
      <SidebarSkeleton />
      <div className="flex min-w-0 flex-1 flex-col gap-4 px-6 pt-10 md:px-12">
        <Block className="h-8 w-48" />
        <Block className="h-4 w-full max-w-xl" />
        <Block className="h-4 w-2/3 max-w-md" />
      </div>
    </div>
  );
}

export function ConfirmPreview({ destination }: { destination: ConfirmDestination }) {
  switch (destination.kind) {
    case "dashboard":
      return <DashboardSkeleton />;
    case "new-lesson":
      return <NewLessonSkeleton topic={destination.topic} />;
    // `claim` draws the real read-only lesson once TEACH-224/245 land; until then, the frame.
    case "claim":
    case "other":
      return <ShellSkeleton />;
  }
}
