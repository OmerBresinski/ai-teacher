import { Slot } from "@radix-ui/react-slot";
import { PanelLeft } from "lucide-react";
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { cn } from "../lib/cn";

import { IconButton } from "./icon-button";
import { Tooltip } from "./tooltip";

const SidebarContext = createContext({ collapsed: false });

export type SidebarProps = React.ComponentProps<"nav"> & {
  children: ReactNode;
  wordmark?: ReactNode;
  mark?: ReactNode;
  foot?: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  "aria-label": string;
};

function Sidebar({
  children,
  wordmark,
  mark,
  foot,
  collapsed: collapsedProp,
  onCollapsedChange,
  className,
  "aria-label": ariaLabel,
  ...props
}: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const collapsed = collapsedProp ?? internalCollapsed;

  const toggle = () => {
    const next = !collapsed;
    if (collapsedProp === undefined) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const root = navRef.current;
    if (!root) return;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>('[data-sidebar-item]:not([aria-disabled="true"])'),
    );
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (event.key === "End") next = items.length - 1;
    else if (event.key === "Home") next = 0;
    else if (current >= 0) {
      next = (current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
    } else if (event.key === "ArrowUp") {
      next = items.length - 1;
    }

    event.preventDefault();
    items[next]?.focus();
  });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.addEventListener("keydown", onKeyDown);
    return () => nav.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <nav
        ref={navRef}
        aria-label={ariaLabel}
        style={{ width: collapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)" }}
        className={cn(
          "sticky top-0 flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "mt-8 flex h-9 items-center",
            collapsed ? "justify-center" : "justify-between pl-[22px] pr-3",
          )}
        >
          {collapsed ? (mark ?? wordmark) : wordmark}
          {collapsed ? null : (
            <IconButton label="Collapse sidebar" size="sm" onClick={toggle}>
              <PanelLeft aria-hidden size={16} strokeWidth={1.5} />
            </IconButton>
          )}
        </div>
        {collapsed ? (
          <IconButton label="Expand sidebar" size="sm" className="mx-auto mt-2" onClick={toggle}>
            <PanelLeft aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        ) : null}
        <div className={cn("flex flex-col gap-0.5", collapsed ? "mt-4 px-2.5" : "mt-6 px-3")}>
          {children}
        </div>
        {foot ? (
          <div className={cn("mt-auto flex flex-col gap-0.5 pb-3", collapsed ? "px-2.5" : "px-3")}>
            {foot}
          </div>
        ) : null}
      </nav>
    </SidebarContext.Provider>
  );
}

type SidebarItemSharedProps = {
  children: ReactNode;
  icon: ReactNode;
  count?: number;
  active?: boolean;
  disabled?: boolean;
  asChild?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  href?: string;
  className?: string;
};

export type SidebarItemProps = SidebarItemSharedProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof SidebarItemSharedProps>;

function labelFrom(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (
    isValidElement<{ children?: ReactNode }>(children) &&
    typeof children.props.children === "string"
  ) {
    return children.props.children;
  }
  return "";
}

function SidebarItem({
  children,
  icon,
  count,
  active = false,
  disabled = false,
  asChild = false,
  href,
  className,
  ...props
}: SidebarItemProps) {
  const { collapsed } = useContext(SidebarContext);
  const label = labelFrom(children);
  const body = (
    <>
      <span aria-hidden className="flex shrink-0 items-center justify-center [&_svg]:size-4">
        {icon}
      </span>
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count === undefined ? null : (
            <span className="shrink-0 text-eyebrow text-ink-3 tabular-nums">{count}</span>
          )}
        </>
      )}
    </>
  );
  const shared = {
    "data-sidebar-item": "",
    "aria-current": active ? ("page" as const) : undefined,
    "aria-disabled": disabled || undefined,
    className: cn(
      "flex h-8 items-center rounded-control px-2 text-left outline-none motion-safe:transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
      collapsed ? "justify-center" : "gap-2",
      active
        ? "bg-brand-quiet font-semibold text-foreground [&_svg]:text-brand-text"
        : "text-ink-2 hover:bg-accent hover:text-foreground",
      className,
    ),
  };

  let item: React.ReactNode;
  if (asChild) {
    const child = Children.only(children);
    if (!isValidElement(child))
      throw new Error("SidebarItem with asChild requires one element child.");
    item = (
      <Slot {...shared} {...props}>
        {cloneElement(child, undefined, body)}
      </Slot>
    );
  } else if (href) {
    item = (
      <a href={href} {...shared} {...props}>
        {body}
      </a>
    );
  } else {
    item = (
      <button type="button" disabled={disabled} {...shared} {...props}>
        {body}
      </button>
    );
  }

  return collapsed ? (
    <Tooltip label={label} side="right">
      {item}
    </Tooltip>
  ) : (
    item
  );
}

export { Sidebar, SidebarItem };
