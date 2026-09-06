import { Link, useNavigate } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardOverlay,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  IconButton,
  ListSurfaceCell,
  ListSurfaceRow,
  toast,
  useInlineRename,
} from "@tj/ui";
import {
  Copy,
  Download,
  MoreHorizontal,
  Pencil,
  Play,
  Printer,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { absoluteTime, relativeTime, sizeOf, yearAndSubject } from "@/lib/format";
import type { DocumentSummary } from "@/mocks/library-schema";
import { LessonThumb } from "./lesson-thumb";

type DocumentAction = "open" | "present" | "duplicate" | "export" | "delete";

export type LibraryCardProps = {
  doc: DocumentSummary;
  view?: "grid" | "list";
  hero?: boolean;
  now: number;
  className?: string;
  onAction: (action: DocumentAction, doc: DocumentSummary) => void;
  onRename: (doc: DocumentSummary, title: string) => void;
};

function DocumentLink({
  doc,
  className,
  hidden = false,
  children,
  onDoubleClick,
}: {
  doc: DocumentSummary;
  className?: string;
  hidden?: boolean;
  children?: ReactNode;
  onDoubleClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const props = { className, hidden, onDoubleClick, "aria-label": `Open ${doc.title}` };
  return doc.kind === "lesson" ? (
    <Link to="/l/$lessonId" params={{ lessonId: doc.id }} {...props}>
      {children}
    </Link>
  ) : (
    <Link to="/w/$worksheetId" params={{ worksheetId: doc.id }} {...props}>
      {children}
    </Link>
  );
}

function DocumentMenu({
  doc,
  onAction,
  onRename,
  className,
}: {
  doc: DocumentSummary;
  onAction: LibraryCardProps["onAction"];
  onRename: () => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="More actions" noTooltip size="sm" className={className}>
          <MoreHorizontal aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onAction("open", doc)}>
          <SquareArrowOutUpRight aria-hidden />
          Open
        </DropdownMenuItem>
        {doc.kind === "lesson" ? (
          <DropdownMenuItem onSelect={() => onAction("present", doc)}>
            <Play aria-hidden />
            Present
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("duplicate", doc)}>
          <Copy aria-hidden />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toast("Export arrives with the editor")}>
          <Download aria-hidden />
          Export JSON
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRename}>
          <Pencil aria-hidden />
          Rename
          <DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => onAction("delete", doc)}>
          <Trash2 aria-hidden />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EditedTime({
  updatedAt,
  now,
  prefix = "",
}: {
  updatedAt: string;
  now: number;
  prefix?: string;
}) {
  return (
    <time dateTime={updatedAt} title={absoluteTime(updatedAt)}>
      {prefix}
      {relativeTime(updatedAt, now)}
    </time>
  );
}

export function LibraryCard({
  doc,
  view = "grid",
  hero = false,
  now,
  className,
  onAction,
  onRename,
}: LibraryCardProps) {
  const navigate = useNavigate();
  const rename = useInlineRename(doc.title, { onCommit: (title) => onRename(doc, title) });
  const subject = yearAndSubject(doc);
  const primaryLabel = doc.kind === "lesson" ? "Present" : "Print";

  function primaryAction(): void {
    if (doc.kind === "lesson") onAction("present", doc);
    else void navigate({ to: "/w/$worksheetId/print", params: { worksheetId: doc.id } });
  }

  const title = rename.editing ? (
    <input
      aria-label={`Rename ${doc.title}`}
      className="relative z-2 h-7 w-full rounded-control border border-ring bg-card px-2 text-lead font-semibold text-foreground outline-none"
      {...rename.inputProps}
    />
  ) : (
    doc.title
  );

  if (view === "list") {
    return (
      <ListSurfaceRow onKeyDown={rename.onCardKeyDown} className={className}>
        <ListSurfaceCell className="w-16">
          <div className="h-9 w-16 overflow-hidden rounded-chip">
            <LessonThumb lesson={doc} />
          </div>
        </ListSurfaceCell>
        <ListSurfaceCell className="min-w-0">
          {rename.editing ? (
            title
          ) : (
            <DocumentLink
              doc={doc}
              onDoubleClick={(event) => {
                event.preventDefault();
                rename.start();
              }}
              className="relative z-2 block truncate font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {doc.title}
            </DocumentLink>
          )}
        </ListSurfaceCell>
        <ListSurfaceCell className="w-32 truncate text-meta text-ink-3">{subject}</ListSurfaceCell>
        <ListSurfaceCell className="w-[152px] text-meta text-ink-3">{sizeOf(doc)}</ListSurfaceCell>
        <ListSurfaceCell className="w-24 text-meta text-ink-3">
          <EditedTime updatedAt={doc.updatedAt} now={now} />
        </ListSurfaceCell>
        <ListSurfaceCell className="w-[104px]">
          <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100">
            <Button size="xs" className="relative z-2" onClick={primaryAction}>
              {primaryLabel}
            </Button>
            <div className="relative z-2">
              <DocumentMenu doc={doc} onAction={onAction} onRename={rename.start} />
            </div>
          </div>
        </ListSurfaceCell>
      </ListSurfaceRow>
    );
  }

  const meta = hero ? (
    <>
      {subject ? <span>{subject}</span> : null}
      {subject ? <span aria-hidden>·</span> : null}
      <span>{sizeOf(doc)}</span>
      <span aria-hidden>·</span>
      <EditedTime updatedAt={doc.updatedAt} now={now} prefix="Edited " />
    </>
  ) : (
    <>
      {subject ? <span>{subject}</span> : null}
      {subject ? <span aria-hidden>·</span> : null}
      <EditedTime updatedAt={doc.updatedAt} now={now} />
    </>
  );

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the focusable cover link bubbles F2 from every card control.
    <article
      className={cn("group/card relative", hero && "col-span-2", className)}
      onKeyDown={rename.onCardKeyDown}
      onDoubleClick={rename.start}
    >
      <DocumentLink
        doc={doc}
        hidden={rename.editing}
        className="absolute inset-0 z-1 rounded-face outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Card
        variant="contained"
        thumbnail={<LessonThumb lesson={doc} />}
        overlay={
          hero ? undefined : (
            <CardOverlay>
              <Button
                size="sm"
                className="relative z-2 pointer-events-auto"
                onClick={primaryAction}
              >
                {doc.kind === "lesson" ? (
                  <Play aria-hidden size={16} />
                ) : (
                  <Printer aria-hidden size={16} />
                )}
                {primaryLabel}
              </Button>
              <div className="relative z-2 pointer-events-auto">
                <DocumentMenu doc={doc} onAction={onAction} onRename={rename.start} />
              </div>
            </CardOverlay>
          )
        }
        heading={title}
        meta={meta}
      >
        {hero ? (
          <div className="relative z-2 mt-2 flex items-center justify-between gap-2">
            <Button size="sm" onClick={primaryAction}>
              <Play aria-hidden size={16} />
              Present
            </Button>
            <DocumentMenu doc={doc} onAction={onAction} onRename={rename.start} />
          </div>
        ) : (
          <div className="relative z-2 hidden justify-end pointer-coarse:flex">
            <DocumentMenu doc={doc} onAction={onAction} onRename={rename.start} />
          </div>
        )}
      </Card>
    </article>
  );
}
