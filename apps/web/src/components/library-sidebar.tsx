import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Display,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Sidebar,
  SidebarItem,
  useTheme,
} from "@tj/ui";
import {
  CircleHelp,
  FileText,
  House,
  Layers,
  LogOut,
  Presentation,
  SunMoon,
  Upload,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth";
import { libraryQueries, librarySelectors } from "@/lib/library";
import { queryKeys } from "@/lib/query";

const COLLAPSED_KEY = "tj:sidebar-collapsed";
const COLLAPSED_EVENT = "tj:sidebar-collapsed";

// Static icons hoisted so a pathname or count change does not rebuild them (rendering-hoist-jsx).
const ICON = { size: 16, strokeWidth: 1.5 } as const;
const HOME_ICON = <House {...ICON} />;
const LESSONS_ICON = <Presentation {...ICON} />;
const WORKSHEETS_ICON = <FileText {...ICON} />;
const SERIES_ICON = <Layers {...ICON} />;
const IMPORT_ICON = <Upload {...ICON} />;
const SHORTCUTS_ICON = <CircleHelp {...ICON} />;
const THEME_ICON = <SunMoon {...ICON} />;
const SIGN_OUT_ICON = <LogOut {...ICON} />;
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

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeCollapsed(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSED_KEY) onChange();
  };
  window.addEventListener(COLLAPSED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

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
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const { theme, setTheme } = useTheme();
  // `select` keeps the sidebar subscribed to three numbers, not to every card's fields.
  const { data: documentCounts } = useQuery({
    ...libraryQueries.documents(),
    select: librarySelectors.countsByKind,
  });
  const { data: seriesCount } = useQuery({
    ...libraryQueries.series(),
    select: librarySelectors.length,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  function setCollapsed(next: boolean): void {
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // The UI still changes in this tab when client storage is unavailable.
    }
    window.dispatchEvent(new Event(COLLAPSED_EVENT));
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
      wordmark={WORDMARK}
      mark={MARK}
      foot={
        <>
          <SidebarItem icon={IMPORT_ICON} onClick={onImport}>
            Import
          </SidebarItem>
          <SidebarItem icon={SHORTCUTS_ICON} onClick={onShortcuts}>
            Keyboard shortcuts
          </SidebarItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarItem icon={THEME_ICON}>Theme</SidebarItem>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => setTheme(value as typeof theme)}
              >
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="high-contrast">High contrast</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
        count={documentCounts?.lesson}
        active={isActive(pathname, "/lessons")}
      >
        <Link to="/lessons">Lessons</Link>
      </SidebarItem>
      <SidebarItem
        asChild
        icon={WORKSHEETS_ICON}
        count={documentCounts?.worksheet}
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
