import { useMutation } from "@tanstack/react-query";
import type { SourceRef } from "@tj/domain/documents";
import { Button, cn, IconButton, Spinner, Textarea } from "@tj/ui";
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
  onChange,
  onBusyChange,
  disabled = false,
}: {
  sources: SourceRef[];
  onChange: (next: SourceRef[]) => void;
  /** Called with `true` while an upload or removal is in flight; Generate is disabled meanwhile. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const pasteId = useId();
  const liveId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<{ key: number; label: string; input: UploadSourceInput }[]>(
    [],
  );
  const [notices, setNotices] = useState<Notice[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(0);

  const upload = useMutation(sourceMutations.upload());
  const remove = useMutation(sourceMutations.remove());
  const busy = queue.length > 0 || remove.isPending;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  // The upload effect reads the latest list and callback when it settles, without re-running.
  const latest = useRef({ sources, onChange });
  latest.current = { sources, onChange };

  const full = sources.length + queue.length >= MAX_SOURCES;
  const inert = disabled || full;

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
  const uploadOne = upload.mutateAsync;
  useEffect(() => {
    if (!head || running.current === head.key) return;
    running.current = head.key;
    uploadOne(head.input)
      .then((source) => {
        latest.current.onChange([...latest.current.sources, source]);
        setAnnouncement(`Added ${source.name}`);
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
    enqueue([{ label: "Pasted text", input: { text } }]);
    setPasteText("");
    setPasteOpen(false);
  };

  const removeSource = async (source: SourceRef) => {
    try {
      await remove.mutateAsync(source.id);
      onChange(sources.filter((s) => s.id !== source.id));
      setAnnouncement(`Removed ${source.name}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not remove that file.");
    }
  };

  return (
    <section aria-labelledby={`${inputId}-title`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={`${inputId}-title`} className="text-body font-medium text-foreground">
          Start from your material
          <span className="ml-2 text-meta font-normal text-ink-3">optional</span>
        </h2>
        <p className="text-meta text-ink-3">
          A chapter, last year's slides or a scheme of work. The plan follows its order and its
          words.
        </p>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the drop target is a pointer-only convenience; the real controls are the labelled button and file input inside it. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: same — drag events have no keyboard equivalent, and every action is reachable through the buttons. */}
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-card border border-dashed p-5 text-center transition-colors",
          dragging && !inert ? "border-accent bg-accent/5" : "border-border-control/60 bg-card",
          inert && "opacity-60",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          if (!inert) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="source-drop-zone"
      >
        <Upload aria-hidden size={20} strokeWidth={1.5} className="text-ink-3" />
        <p className="text-body text-foreground">
          {full ? LIMIT_NOTICE : "Drop a PDF, PowerPoint or Word file here"}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={inert}
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={inert}
            aria-expanded={pasteOpen}
            aria-controls={pasteId}
            onClick={() => setPasteOpen((open) => !open)}
          >
            Paste text instead
          </Button>
        </div>
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
        <p className="text-meta text-ink-3">{COPYRIGHT_NOTICE}</p>
      </div>

      {pasteOpen ? (
        <div id={pasteId} className="flex flex-col gap-2">
          <Textarea
            aria-label="Text to use as material"
            rows={6}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="Paste the text of a chapter, a worksheet or your notes"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={inert || pasteText.trim().length === 0}
              onClick={addPaste}
            >
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {sources.length > 0 || queue.length > 0 ? (
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
                onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
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
  );
}

function SourceIcon({ source }: { source: SourceRef }) {
  const props = { "aria-hidden": true, size: 18, strokeWidth: 1.5, className: "text-ink-3" };
  if (source.kind === "paste") return <StickyNote {...props} />;
  if (source.name.toLowerCase().endsWith(".pptx")) return <Presentation {...props} />;
  return <FileText {...props} />;
}
