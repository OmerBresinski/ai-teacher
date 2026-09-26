import { useMutation } from "@tanstack/react-query";
import type { SourceRef } from "@tj/domain/documents";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@tj/ui";
import { CharacterHost } from "@/components/lesson-creation/character-host";
import "./materials.css";
import { FileText, Presentation, StickyNote, Upload, X } from "lucide-react";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import {
  describeSource,
  FILE_TOO_LARGE_MESSAGE,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCES,
  SOURCE_ACCEPT,
  sourceMutations,
  type UploadSourceInput,
} from "@/lib/sources";

/*
 * The brief's "Start from your material" block (ADR 0027 §7): drop or choose up to three PDF /
 * PPTX / DOCX files, or paste text, each uploaded through `POST /sources` one at a time. An
 * accepted Source is a chip the teacher can remove; a refused one shows the API's sentence
 * verbatim under the zone. The parent owns the accepted list (it becomes `sourceIds`), this
 * component owns the in-flight queue and the refusal notices.
 */

export const COPYRIGHT_NOTICE = "Only upload material you may use for your own teaching.";
export const LIMIT_NOTICE = "Up to three files.";

type Notice = { id: number; message: string };

export function SourceDropZone({
  sources,
  boundSourceIds = [],
  onChange,
  onBusyChange,
  disabled = false,
  focusChooseFiles = false,
  open = true,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sources: SourceRef[];
  /** Existing lesson sources are unbound transactionally by /plan, never deleted here. */
  boundSourceIds?: readonly string[];
  /**
   * Receives an updater, not a list: an upload finishing while a removal is in flight (or the
   * other way round) must each apply to the list as it is *then*, never to the render they started
   * in. The brief passes it straight to `setState`-style `patch`.
   */
  onChange: (update: (current: SourceRef[]) => SourceRef[]) => void;
  /** Called with `true` while an upload or removal is in flight; Generate is disabled meanwhile. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  /** `?source=1` (TEACH-309): scroll this zone into view and focus "Choose files" once, on mount. */
  focusChooseFiles?: boolean;
}) {
  const inputId = useId();
  const pasteId = useId();
  const liveId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const chooseFilesRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<{ key: number; label: string; input: UploadSourceInput }[]>(
    [],
  );
  const [notices, setNotices] = useState<Notice[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const dragDepth = useRef(0);
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(0);

  const upload = useMutation(sourceMutations.upload());
  const remove = useMutation(sourceMutations.remove());
  const busy = queue.length > 0 || remove.isPending;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  // The upload effect reads the latest callback when it settles, without re-running.
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  const full = sources.length + queue.length >= MAX_SOURCES;
  const inert = disabled || full;

  // Runs once, on mount, from the URL the page opened with (`?source=1`, TEACH-309).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only.
  useEffect(() => {
    if (!focusChooseFiles) return;
    sectionRef.current?.scrollIntoView({ block: "nearest" });
    chooseFilesRef.current?.focus();
  }, []);

  const notify = (message: string) => {
    setNotices((current) => [...current, { id: nextKey.current++, message }]);
    setAnnouncement(message);
  };

  const enqueue = (items: { label: string; input: UploadSourceInput }[]) => {
    const room = MAX_SOURCES - sources.length - queue.length;
    if (room <= 0) return;
    const accepted = items.slice(0, room);
    if (accepted.length < items.length) notify(LIMIT_NOTICE);
    setQueue((current) => [
      ...current,
      ...accepted.map((item) => ({ ...item, key: nextKey.current++ })),
    ]);
  };

  // One upload at a time: the head of the queue runs, then the queue advances.
  const head = queue[0];
  const running = useRef<number | null>(null);
  const fingerprints = useRef(new Map<string, string>());
  const latestSources = useRef(sources);
  latestSources.current = sources;
  const uploadOne = upload.mutateAsync;
  useEffect(() => {
    if (!head || running.current === head.key) return;
    running.current = head.key;
    const uploadUnique = async () => {
      if (!("file" in head.input)) return uploadOne(head.input);
      const bytes = await head.input.file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (latestSources.current.some((source) => fingerprints.current.get(source.id) === hash)) {
        throw new Error(`${head.label} is already added.`);
      }
      const source = await uploadOne(head.input);
      fingerprints.current.set(source.id, hash);
      return source;
    };
    uploadUnique()
      .then((source) => {
        latestOnChange.current((current) => [...current, source]);
        setAnnouncement(`Added ${source.name}`);
        if ("text" in head.input) {
          setPasteText("");
          setPasteName("");
          setPasteOpen(false);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setNotices((current) => [...current, { id: nextKey.current++, message }]);
        setAnnouncement(message);
      })
      .finally(() => {
        running.current = null;
        setQueue((current) => current.filter((item) => item.key !== head.key));
      });
  }, [head, uploadOne]);

  const addFiles = (files: FileList | File[]) => {
    const items: { label: string; input: UploadSourceInput }[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(pdf|pptx|docx)$/i.test(file.name)) {
        notify(`${file.name}: Choose a PDF, PowerPoint or Word file.`);
        continue;
      }
      if (file.size > MAX_SOURCE_FILE_BYTES) {
        notify(`${file.name}: ${FILE_TOO_LARGE_MESSAGE}`);
        continue;
      }
      items.push({ label: file.name, input: { file } });
    }
    if (items.length > 0) enqueue(items);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (inert) return;
    addFiles(event.dataTransfer.files);
  };

  const addPaste = () => {
    const text = pasteText.trim();
    if (text.length === 0) return;
    enqueue([
      {
        label: pasteName.trim() || "Pasted text",
        input: { text, name: pasteName.trim() || undefined },
      },
    ]);
  };

  const removeSource = async (source: SourceRef) => {
    try {
      if (!boundSourceIds.includes(source.id)) await remove.mutateAsync(source.id);
      onChange((current) => current.filter((s) => s.id !== source.id));
      setAnnouncement(`Removed ${source.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not remove that file.");
    }
  };

  const attachmentList =
    sources.length > 0 || queue.length > 0 ? (
      <ul className="flex flex-col gap-2" aria-label="Your material">
        {sources.map((source) => (
          <li
            key={source.id}
            className="flex items-center gap-3 rounded-card border border-border-control/40 bg-card px-3 py-2"
          >
            <SourceIcon source={source} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-foreground">{source.name}</p>
              <p className="text-meta text-ink-3">{describeSource(source)}</p>
            </div>
            <IconButton
              type="button"
              label={`Remove ${source.name}`}
              disabled={disabled || remove.isPending}
              onClick={() => void removeSource(source)}
            >
              <X aria-hidden size={16} strokeWidth={1.5} />
            </IconButton>
          </li>
        ))}
        {queue.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-3 rounded-card border border-border-control/40 bg-card px-3 py-2 text-ink-3"
          >
            <Spinner />
            <p className="truncate text-body">
              {item.label}
              <span className="sr-only"> uploading</span>
            </p>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <>
      {!open ? attachmentList : null}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setDragging(false);
          dragDepth.current = 0;
          onOpenChange?.(value);
        }}
      >
        <DialogContent
          size="xl"
          className="materials-dialog"
          data-has-materials={sources.length + queue.length > 0}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length === 0) return;
            event.preventDefault();
            if (disabled) return;
            if (full) {
              notify(LIMIT_NOTICE);
              return;
            }
            addFiles(files);
          }}
        >
          <section ref={sectionRef} className="materials-body">
            <header className="materials-header">
              <div>
                <DialogTitle>Add your materials</DialogTitle>
                <DialogDescription>
                  Bring a chapter, slides or notes into your lesson.
                </DialogDescription>
              </div>
              <div className="materials-character" aria-hidden="true">
                <CharacterHost stage="worksheet" initialStage="worksheet" />
              </div>
            </header>
            <Tabs
              value={pasteOpen ? "text" : "files"}
              onValueChange={(value) => setPasteOpen(value === "text")}
            >
              <TabsList aria-label="Material input method">
                <TabsTrigger value="files">Upload files</TabsTrigger>
                <TabsTrigger value="text">Paste text</TabsTrigger>
              </TabsList>
              <TabsContent value={pasteOpen ? "text" : "files"}>
                {pasteOpen ? (
                  <div id={pasteId} className="materials-input materials-paste">
                    <label htmlFor={`${pasteId}-name`}>
                      Title <span className="text-ink-3 font-normal">(optional)</span>
                    </label>
                    <Input
                      id={`${pasteId}-name`}
                      value={pasteName}
                      onChange={(event) => setPasteName(event.target.value)}
                      placeholder="e.g. Water cycle notes"
                      maxLength={120}
                      disabled={inert}
                    />
                    <label htmlFor={`${pasteId}-text`}>Your text</label>
                    <Textarea
                      id={`${pasteId}-text`}
                      aria-label="Text to use as material"
                      rows={6}
                      value={pasteText}
                      disabled={inert}
                      onChange={(event) => setPasteText(event.target.value)}
                      placeholder="Paste a chapter, curriculum extract or your notes…"
                    />
                    <div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={inert || busy || !pasteText.trim()}
                        onClick={addPaste}
                      >
                        Add text
                      </Button>
                    </div>
                  </div>
                ) : (
                  // biome-ignore lint/a11y/noStaticElementInteractions: drag is supplemental to the labelled file picker.
                  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: drag is supplemental to the labelled file picker.
                  <div
                    className={cn(
                      "materials-input materials-drop",
                      dragging && !inert && "is-dragging",
                      inert && "opacity-60",
                    )}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      dragDepth.current++;
                      if (!inert) setDragging(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      if (--dragDepth.current <= 0) {
                        dragDepth.current = 0;
                        setDragging(false);
                      }
                    }}
                    onDrop={(event) => {
                      dragDepth.current = 0;
                      onDrop(event);
                    }}
                    data-testid="source-drop-zone"
                  >
                    <div className="materials-drop-icon">
                      <Upload aria-hidden size={28} strokeWidth={1.5} />
                    </div>
                    <p className="materials-drop-title">
                      {full
                        ? "Your materials are ready"
                        : dragging
                          ? "Drop to add to your lesson"
                          : "Drop or paste your files here"}
                    </p>
                    <p className="text-meta text-ink-3">
                      {full ? LIMIT_NOTICE : "PDF, PowerPoint or Word · Up to 25 MB each"}
                    </p>
                    <Button
                      ref={chooseFilesRef}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={inert}
                      onClick={() => inputRef.current?.click()}
                    >
                      Choose files
                    </Button>
                    <input
                      ref={inputRef}
                      id={inputId}
                      type="file"
                      accept={SOURCE_ACCEPT}
                      multiple
                      className="sr-only"
                      aria-label="Choose files"
                      disabled={inert}
                      onChange={(event) => {
                        if (event.target.files) addFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </div>
                )}
              </TabsContent>
            </Tabs>
            {sources.length + queue.length > 0 ? (
              <div className="materials-attachments">
                <p className="text-meta text-ink-3">
                  Lesson materials · {sources.length + queue.length}/{MAX_SOURCES}
                </p>
                {attachmentList}
              </div>
            ) : null}

            {notices.length > 0 ? (
              <ul className="flex flex-col gap-2" aria-label="Files we could not take">
                {notices.map((notice) => (
                  <li
                    key={notice.id}
                    className="flex items-start gap-2 rounded-card border border-destructive/40 bg-destructive/5 px-3 py-2 text-body text-foreground"
                  >
                    <p className="flex-1">{notice.message}</p>
                    <IconButton
                      type="button"
                      label="Dismiss"
                      onClick={() =>
                        setNotices((current) => current.filter((n) => n.id !== notice.id))
                      }
                    >
                      <X aria-hidden size={16} strokeWidth={1.5} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            ) : null}

            <p id={liveId} aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </section>
          <footer className="materials-footer">
            <p className="text-meta text-ink-3">{COPYRIGHT_NOTICE}</p>
            <Button type="button" variant="inverse" onClick={() => onOpenChange?.(false)}>
              Done
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SourceIcon({ source }: { source: SourceRef }) {
  const props = { "aria-hidden": true, size: 18, strokeWidth: 1.5, className: "text-ink-3" };
  if (source.kind === "paste") return <StickyNote {...props} />;
  if (source.name.toLowerCase().endsWith(".pptx")) return <Presentation {...props} />;
  return <FileText {...props} />;
}
