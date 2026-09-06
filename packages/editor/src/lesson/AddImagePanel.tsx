import { useInfiniteQuery } from "@tanstack/react-query";
import type { ImageElement, SlideElement } from "@tj/domain/documents";
import {
  Button,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@tj/ui";
import { Upload, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { SearchError, type StockImage, searchOpenverse } from "../images/image-search";
import { makeImage } from "../model/insert";
import * as reducers from "../model/reducers";
import { useHistory, useLesson } from "./document-context";
import { type ImageSource, imageFields, sourceFromFile, sourceFromStock } from "./image-source";
import { useActiveSlide, useSessionActions, useSessionUi } from "./use-editor-session";

/*
 * "Add image" (TeachDeck `components/v2/editor/AddImagePanel.tsx`): upload a file or search
 * Openverse for a picture, anchored to the rail's Image button. Tenor GIF search is not ported
 * (TEACH-107: it needs a client-side key). Open/closed and the replace target live in the session
 * (`imagePanel`), so the rail button, the `i` shortcut and the image toolbar's Replace all reach
 * the same popover. Search pages live in TanStack Query; only the typed text is local state.
 */

const ACCEPT = "image/png,image/jpeg,image/gif,image/svg+xml,image/webp";
export const LINK_FALLBACK_MESSAGE = "Added as a link. It will not appear in exports.";
export const UNREADABLE_MESSAGE = "That image could not be read.";
export const SEARCH_FAILED_MESSAGE = "Search failed. Try again.";
export const RATE_LIMITED_MESSAGE = "Too many searches. Try again in a minute.";
/** A search fires this long after the last keystroke; Enter fires it at once. */
const DEBOUNCE_MS = 400;

export type AddImagePanelProps = {
  /** The rail button the popover anchors to and toggles from. */
  children: ReactNode;
  onInsert: (el: SlideElement) => void;
};

export function AddImagePanel({ children, onInsert }: AddImagePanelProps) {
  const { imagePanel } = useSessionUi();
  const { openImagePanel, closeImagePanel } = useSessionActions();
  const lesson = useLesson();
  const history = useHistory();
  const slide = useActiveSlide(lesson.slides);
  const replacing = imagePanel?.mode === "replace" ? imagePanel.elementId : null;
  // When this open began. The content stays mounted through its fade-out and a pointer down in
  // that window is reported by Radix a tick later — after a click on Replace has already opened
  // the panel again — so a dismiss whose pointer down predates the open is not about this open.
  const openedAt = useRef(0);
  useLayoutEffect(() => {
    if (imagePanel) openedAt.current = performance.now();
  }, [imagePanel]);

  const pick = (source: ImageSource) => {
    if (replacing && slide) {
      // Same id, same frame; a plain upload over a searched image clears the old credit.
      history.dispatch(reducers.updateElement<ImageElement>, slide.id, replacing, {
        alt: undefined,
        credit: undefined,
        creditUrl: undefined,
        ...imageFields(source),
      });
    } else {
      onInsert({ ...makeImage(source.src, source.natural), ...imageFields(source) });
    }
    closeImagePanel();
  };

  return (
    <Popover
      open={imagePanel !== null}
      onOpenChange={(open) => (open ? openImagePanel() : closeImagePanel())}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-[360px] p-0"
        aria-label={replacing ? "Replace image" : "Add image"}
        data-add-image-panel
        onInteractOutside={(e) => {
          if (e.detail.originalEvent.timeStamp < openedAt.current) e.preventDefault();
        }}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
          <h2 className="m-0 font-semibold text-body text-foreground">
            {replacing ? "Replace image" : "Add image"}
          </h2>
          <IconButton label="Close" size="sm" noTooltip onClick={closeImagePanel}>
            <X aria-hidden size={16} strokeWidth={1.5} />
          </IconButton>
        </div>
        <Tabs defaultValue="upload" className="gap-1">
          <TabsList aria-label="Image source" className="mx-3">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <UploadTab onPick={pick} />
          </TabsContent>
          <TabsContent value="photos">
            <PhotosTab onPick={pick} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

function UploadTab({ onPick }: { onPick: (source: ImageSource) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const dropLabel = useId();
  // Decoding a large file takes a moment; if the panel closed meanwhile (Esc, a click outside, a
  // different element selected for Replace) the picture must not land on whatever is there now.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const take = async (files: FileList | null) => {
    const chosen = files?.[0];
    if (!chosen) return;
    try {
      const source = await sourceFromFile(chosen);
      if (alive.current) onPick(source);
    } catch {
      if (alive.current) toast(UNREADABLE_MESSAGE);
    }
  };

  return (
    <div className="p-3 pt-1">
      {/* A drop target is not a control: the drag handlers stay on the region and the
          click-to-browse affordance is the real Button inside it. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: drop handlers only; the Button inside is the activation */}
      {/* biome-ignore lint/a11y/useSemanticElements: a drop zone is a named group, not a fieldset */}
      <div
        role="group"
        aria-labelledby={dropLabel}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files);
        }}
        className={cn(
          "flex h-[132px] flex-col items-center justify-center gap-2.5 rounded-control border border-dashed border-[var(--border-strong)]",
          "motion-safe:transition-colors",
          over ? "bg-accent" : "bg-muted",
        )}
      >
        <Upload aria-hidden size={16} strokeWidth={1.5} className="text-ink-3" />
        <p id={dropLabel} className="m-0 text-body text-ink-3">
          Drop an image here
        </p>
        <Button variant="secondary" size="sm" onClick={() => file.current?.click()}>
          Choose file
        </Button>
      </div>
      <p className="m-0 pt-2 text-ink-3 text-meta">PNG, JPG, GIF, SVG or WebP</p>
      <input
        ref={file}
        type="file"
        accept={ACCEPT}
        aria-label="Image file"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Photos (Openverse)                                                  */
/* ------------------------------------------------------------------ */

export const openverseQueryKey = (term: string) => ["openverse", term] as const;

function PhotosTab({ onPick }: { onPick: (source: ImageSource) => void }) {
  const [query, setQuery] = useState("");
  // The term the search runs on: `query` a debounce later, or at once on Enter.
  const [term, setTerm] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Openverse hands back a thumbnail URL that sometimes 404s. A tile with a broken-image glyph in
  // it is worse than one fewer result.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  // Closing the panel while the full-size bytes are in flight must not insert into the slide.
  const inflight = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    inflight.current = controller;
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const commit = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setTerm(value.trim());
  };
  const onChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(value), DEBOUNCE_MS);
  };

  const search = useInfiniteQuery({
    queryKey: openverseQueryKey(term),
    queryFn: ({ pageParam, signal }) => searchOpenverse(term, { cursor: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    enabled: term.length > 1,
    staleTime: 5 * 60_000,
    // An error shows at once with a Retry; a silent second attempt would just look stuck.
    retry: false,
  });

  const insert = async (item: StockImage) => {
    setBusy(item.id);
    try {
      const { source, inlined } = await sourceFromStock(item, inflight.current?.signal);
      onPick(source);
      if (!inlined) toast(LINK_FALLBACK_MESSAGE);
    } catch {
      // Only an abort gets this far: the panel closed, so there is nothing to insert into.
    } finally {
      setBusy(null);
    }
  };

  // Deduplicated across pages: Openverse can hand the same row back twice, which would be a
  // duplicate React key as well as a duplicate tile.
  const seen = new Set<string>();
  const items: StockImage[] = [];
  for (const page of search.data?.pages ?? []) {
    for (const item of page.results) {
      if (seen.has(item.id) || broken.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  const total = search.data?.pages.reduce((n, p) => n + p.results.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-2 p-3 pt-1">
      <SearchInput
        autoFocus
        label="Search images"
        placeholder="Search images"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onClear={() => {
          setQuery("");
          commit("");
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          commit(query);
        }}
      />

      {search.isPending && search.fetchStatus === "fetching" ? (
        <Note>
          <Spinner /> Searching
        </Note>
      ) : search.isError ? (
        <Note>
          {search.error instanceof SearchError && search.error.status === 429
            ? RATE_LIMITED_MESSAGE
            : SEARCH_FAILED_MESSAGE}
          <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
            Retry
          </Button>
        </Note>
      ) : !search.data ? null : total === 0 ? (
        <Note>Openverse has nothing for that.</Note>
      ) : (
        <>
          {/* Every thumbnail in the page can 404 while the search itself worked. That is a
              different thing from "nothing matched", and the next page may well load. */}
          {items.length === 0 ? (
            <Note>Those results could not be loaded.</Note>
          ) : (
            <ul className="m-0 grid max-h-[260px] list-none grid-cols-3 gap-1.5 overflow-y-auto p-0">
              {items.map((item) => (
                <li key={item.id} className="m-0">
                  <button
                    type="button"
                    title={item.credit}
                    aria-label={item.credit}
                    aria-busy={busy === item.id || undefined}
                    disabled={busy !== null}
                    onClick={() => void insert(item)}
                    className={cn(
                      "relative block aspect-square w-full overflow-hidden rounded-control bg-muted shadow-1 outline-none",
                      "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      busy !== null && "cursor-progress",
                    )}
                  >
                    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: `error` is the only way to learn a thumbnail 404ed */}
                    <img
                      src={item.thumbnail}
                      alt=""
                      loading="lazy"
                      onError={() => setBroken((prev) => new Set(prev).add(item.id))}
                      className="absolute inset-0 block size-full object-cover"
                    />
                    {busy === item.id ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-card/70 text-foreground">
                        <Spinner />
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.hasNextPage ? (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={search.isFetchingNextPage}
              onClick={() => void search.fetchNextPage()}
            >
              {search.isFetchingNextPage ? <Spinner /> : null}
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex flex-wrap items-center justify-center gap-2 py-6 text-body text-ink-3">
      {children}
    </p>
  );
}
