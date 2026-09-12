import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Display, Sidebar, SidebarItem } from "@tj/ui";
import {
  CircleHelp,
  FileText,
  House,
  Layers,
  LogOut,
  Presentation,
  SwatchBook,
  Upload,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { authClient } from "@/lib/auth";
import { libraryQueries, librarySelectors } from "@/lib/library";
import { queryKeys } from "@/lib/query";
import { usePreference } from "@/lib/use-preference";
import { ThemeMenu } from "./theme-menu";

/** Stable client storage contract (apps/web/AGENTS.md); "1" collapsed, anything else expanded. */
const COLLAPSED_KEY = "tj:sidebar-collapsed";
const COLLAPSED_VALUES = ["0", "1"] as const;

// Static icons hoisted so a pathname or count change does not rebuild them (rendering-hoist-jsx).
const ICON = { size: 16, strokeWidth: 1.5 } as const;
const HOME_ICON = <House {...ICON} />;
const LESSONS_ICON = <Presentation {...ICON} />;
const WORKSHEETS_ICON = <FileText {...ICON} />;
const SERIES_ICON = <Layers {...ICON} />;
const IMPORT_ICON = <Upload {...ICON} />;
const SHORTCUTS_ICON = <CircleHelp {...ICON} />;
const SIGN_OUT_ICON = <LogOut {...ICON} />;
const KIT_ICON = <SwatchBook {...ICON} />;
const WORDMARK = (
  <Display as="span" size="md" className="whitespace-nowrap">
    TeachDeck
  </Display>
);
const MARK = (
  <Display as="span" size="md">
    T
  </Display>
);

const PreviewWordmark = import.meta.env.DEV
  ? lazy(() =>
      import("./design-preview/design-preview").then((m) => ({ default: m.DesignWordmark })),
    )
  : () => null;

function isActive(pathname: string, href: "/" | "/lessons" | "/worksheets" | "/series"): boolean {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function LibrarySidebar({
  onImport,
  onShortcuts,
}: {
  onImport: () => void;
  onShortcuts: () => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // `usePreference` caches the read and announces same-tab writes, like the sort/view prefs.
  const [collapsedFlag, setCollapsedFlag] = usePreference(COLLAPSED_KEY, COLLAPSED_VALUES, "0");
  const collapsed = collapsedFlag === "1";
  // `select` keeps the sidebar subscribed to three numbers, not to every card's fields. The API
  // returns no totals (ADR 0024 §17), so each count is the rows loaded so far — exact until a
  // list grows past its first page of 100; F16 decides whether exact counts matter.
  const { data: lessonCount } = useInfiniteQuery({
    ...libraryQueries.documents("lesson"),
    select: librarySelectors.count,
  });
  const { data: worksheetCount } = useInfiniteQuery({
    ...libraryQueries.documents("worksheet"),
    select: librarySelectors.count,
  });
  const { data: seriesCount } = useInfiniteQuery({
    ...libraryQueries.series(),
    select: librarySelectors.count,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  function setCollapsed(next: boolean): void {
    setCollapsedFlag(next ? "1" : "0");
  }

  async function signOut(): Promise<void> {
    await authClient.signOut();
    await queryClient.invalidateQueries({ queryKey: queryKeys.me, refetchType: "all" });
    await navigate({ to: "/sign-in", search: {} });
  }

  return (
    <Sidebar
      aria-label="Library"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      wordmark={
        import.meta.env.DEV ? (
          <Suspense fallback={WORDMARK}>
            <PreviewWordmark />
          </Suspense>
        ) : (
          WORDMARK
        )
      }
      mark={
        import.meta.env.DEV ? (
          <Suspense fallback={MARK}>
            <PreviewWordmark compact />
          </Suspense>
        ) : (
          MARK
        )
      }
      foot={
        <>
          <SidebarItem icon={IMPORT_ICON} onClick={onImport}>
            Import
          </SidebarItem>
          <SidebarItem icon={SHORTCUTS_ICON} onClick={onShortcuts}>
            Keyboard shortcuts
          </SidebarItem>
          {import.meta.env.DEV ? (
            <SidebarItem asChild icon={KIT_ICON} active={pathname === "/kit"}>
              <Link to="/kit">Kit</Link>
            </SidebarItem>
          ) : null}
          <ThemeMenu />
          <SidebarItem icon={SIGN_OUT_ICON} onClick={() => void signOut()}>
            Sign out
          </SidebarItem>
        </>
      }
    >
      <SidebarItem asChild icon={HOME_ICON} active={isActive(pathname, "/")}>
        <Link to="/">Home</Link>
      </SidebarItem>
      <SidebarItem
        asChild
        icon={LESSONS_ICON}
        count={lessonCount}
        active={isActive(pathname, "/lessons")}
      >
        <Link to="/lessons">Lessons</Link>
      </SidebarItem>
      <SidebarItem
        asChild
        icon={WORKSHEETS_ICON}
        count={worksheetCount}
        active={isActive(pathname, "/worksheets")}
      >
        <Link to="/worksheets">Worksheets</Link>
      </SidebarItem>
      <SidebarItem
        asChild
        icon={SERIES_ICON}
        count={seriesCount}
        active={isActive(pathname, "/series")}
      >
        <Link to="/series">Series</Link>
      </SidebarItem>
    </Sidebar>
  );
}
