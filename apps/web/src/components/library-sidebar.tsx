import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth";
import { libraryCounts, libraryQueries } from "@/lib/library";
import { queryKeys } from "@/lib/query";

const COLLAPSED_KEY = "tj:sidebar-collapsed";
const COLLAPSED_EVENT = "tj:sidebar-collapsed";

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

export function LibrarySidebar({ onShortcuts }: { onShortcuts: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [importOpen, setImportOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const documents = useQuery(libraryQueries.documents());
  const series = useQuery(libraryQueries.series());
  const counts = libraryCounts(documents.data ?? [], series.data ?? []);
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
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    await navigate({ to: "/sign-in", search: {} });
  }

  return (
    <>
      <Sidebar
        aria-label="Library"
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        wordmark={
          <Display as="span" size="md">
            Teaching Journey
          </Display>
        }
        mark={
          <Display as="span" size="md">
            TJ
          </Display>
        }
        foot={
          <>
            <SidebarItem
              icon={<Upload size={16} strokeWidth={1.5} />}
              onClick={() => setImportOpen(true)}
            >
              Import
            </SidebarItem>
            <SidebarItem icon={<CircleHelp size={16} strokeWidth={1.5} />} onClick={onShortcuts}>
              Keyboard shortcuts
            </SidebarItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarItem icon={<SunMoon size={16} strokeWidth={1.5} />}>Theme</SidebarItem>
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
            <SidebarItem
              icon={<LogOut size={16} strokeWidth={1.5} />}
              onClick={() => void signOut()}
            >
              Sign out
            </SidebarItem>
          </>
        }
      >
        <SidebarItem
          asChild
          icon={<House size={16} strokeWidth={1.5} />}
          active={isActive(pathname, "/")}
        >
          <Link to="/">Home</Link>
        </SidebarItem>
        <SidebarItem
          asChild
          icon={<Presentation size={16} strokeWidth={1.5} />}
          count={counts.lesson}
          active={isActive(pathname, "/lessons")}
        >
          <Link to="/lessons">Lessons</Link>
        </SidebarItem>
        <SidebarItem
          asChild
          icon={<FileText size={16} strokeWidth={1.5} />}
          count={counts.worksheet}
          active={isActive(pathname, "/worksheets")}
        >
          <Link to="/worksheets">Worksheets</Link>
        </SidebarItem>
        <SidebarItem
          asChild
          icon={<Layers size={16} strokeWidth={1.5} />}
          count={counts.series}
          active={isActive(pathname, "/series")}
        >
          <Link to="/series">Series</Link>
        </SidebarItem>
      </Sidebar>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Import</DialogTitle>
            <DialogDescription>Import arrives with the editor.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
