import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  SearchInput,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@tj/ui";
import { Flag, Upload } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  type ImageSearchClient,
  type PhotoOrientation,
  type PhotoResult,
  type ReportReason,
  SearchError,
} from "./image-search";
import { type ImageSource, sourceFromFile, sourceFromPicked } from "./image-source";

export type { ImageSearchClient };

/*
 * Document-agnostic image picker (Images project): upload a file or search Pexels through the
 * injected client. `AddImagePanel` (lessons) keeps the popover chrome and the lesson-specific
 * `pick()`; the worksheet ticket (TEACH-160) mounts this directly. Search pages live in TanStack
 * Query; only the typed text is local state.
 */

export const UNREADABLE_MESSAGE = "That image could not be read.";
export const SEARCH_FAILED_MESSAGE = "Search failed. Try again.";
export const RATE_LIMITED_MESSAGE = "Too many searches. Try again in a minute.";
export const REPORTED_MESSAGE = "Thanks — we've flagged it.";
export const REPORT_FAILED_MESSAGE = "Could not send the report.";
export const BLOCKED_MESSAGE = "Try a different search.";

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "unsuitable", label: "Unsuitable" },
  { value: "wrong-subject", label: "Wrong subject" },
  { value: "other", label: "Other" },
];
/** A search fires this long after the last keystroke; Enter fires it at once. */
const DEBOUNCE_MS = 400;

export type ImagePickerProps = {
  images?: ImageSearchClient;
  target: "slide" | "worksheet";
  onPick: (source: ImageSource) => void;
};

export function ImagePicker({ images, target, onPick }: ImagePickerProps) {
  return (
    <Tabs defaultValue="upload" className="gap-1">
      <TabsList aria-label="Image source" className="mx-3">
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="photos">Photos</TabsTrigger>
      </TabsList>
      <TabsContent value="upload">
        <UploadTab onPick={onPick} />
      </TabsContent>
      <TabsContent value="photos">
        <PhotosTab images={images} target={target} onPick={onPick} />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

const ACCEPT = "image/png,image/jpeg,image/gif,image/svg+xml,image/webp";

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
/* Photos (Pexels, injected client)                                     */
/* ------------------------------------------------------------------ */

function PhotosTab({
  images,
  target,
  onPick,
}: {
  images?: ImageSearchClient;
  target: "slide" | "worksheet";
  onPick: (source: ImageSource) => void;
}) {
  const [query, setQuery] = useState("");
  // The term the search runs on: `query` a debounce later, or at once on Enter.
  const [term, setTerm] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A tile with a broken-image glyph in it is worse than one fewer result.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  // Reported tiles stay hidden for the rest of the session.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // Closing the panel while a pick is in flight must not insert into the slide.
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

  const orientation: PhotoOrientation | undefined = target === "slide" ? "landscape" : undefined;
  const search = useInfiniteQuery({
    queryKey: ["images", "pexels", term, orientation],
    queryFn: ({ pageParam, signal }) => {
      if (!images) throw new SearchError("Photo search is not available.");
      return images.search(term, { orientation, page: pageParam, signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
    enabled: images !== undefined && term.length > 1,
    staleTime: 5 * 60_000,
    // An error shows at once with a Retry; a silent second attempt would just look stuck.
    retry: false,
  });

  const insert = async (item: PhotoResult) => {
    if (!images) return;
    setBusy(item.id);
    try {
      const picked = await images.pick(item, target, inflight.current?.signal);
      onPick(sourceFromPicked(picked, item.alt));
    } catch (error) {
      // An abort means the panel closed: nothing to insert into, and no toast either.
      if (inflight.current?.signal.aborted) return;
      toast(
        error instanceof SearchError && error.status === 429
          ? RATE_LIMITED_MESSAGE
          : SEARCH_FAILED_MESSAGE,
      );
    } finally {
      setBusy(null);
    }
  };

  if (!images) {
    return <Note>Photo search is not available.</Note>;
  }

  // Deduplicated across pages, which also guards the React keys.
  const seen = new Set<string>();
  const items: PhotoResult[] = [];
  for (const page of search.data?.pages ?? []) {
    for (const item of page.photos) {
      if (seen.has(item.id) || broken.has(item.id) || hidden.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  const total = search.data?.pages.reduce((n, p) => n + p.photos.length, 0) ?? 0;
  const blocked = search.data?.pages.some((page) => page.blocked) ?? false;

  const report = async (item: PhotoResult, reason: ReportReason) => {
    if (!images) return;
    try {
      await images.report({
        photo: { provider: "pexels", id: item.id },
        reason,
        context: "search",
      });
      setHidden((prev) => new Set(prev).add(item.id));
      toast(REPORTED_MESSAGE);
    } catch {
      toast(REPORT_FAILED_MESSAGE);
    }
  };

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
        <Note>{blocked ? BLOCKED_MESSAGE : "No photos found."}</Note>
      ) : (
        <>
          {/* Every thumbnail in the page can 404 while the search itself worked. That is a
              different thing from "nothing matched", and the next page may well load. */}
          {items.length === 0 ? (
            <Note>Those results could not be loaded.</Note>
          ) : (
            <ul className="m-0 grid max-h-[260px] list-none grid-cols-3 gap-1.5 overflow-y-auto p-0">
              {items.map((item) => {
                const label = item.alt || `Photo by ${item.photographer}`;
                return (
                  <li key={item.id} className="group relative m-0">
                    <button
                      type="button"
                      title={label}
                      aria-label={label}
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
                        src={item.src.tiny}
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
                    {images ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            label="Report this image"
                            noTooltip
                            size="sm"
                            className="absolute top-1 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Flag aria-hidden size={14} strokeWidth={1.5} />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" aria-label="Report this image">
                          {REPORT_REASONS.map((reason) => (
                            <DropdownMenuItem
                              key={reason.value}
                              onSelect={() => void report(item, reason.value)}
                            >
                              {reason.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </li>
                );
              })}
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
