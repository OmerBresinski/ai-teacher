import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { type JobEvent, JobEventSchema } from "@tj/domain/jobs";
import { LessonEditor } from "@tj/editor/lesson";
import { PresentView } from "@tj/editor/present";
import { demoLibrary } from "@tj/editor/starter";
import { Button } from "@tj/ui";
import { useEffect, useState } from "react";
import { GeneratingShell } from "@/components/generating-lesson/GeneratingShell";
import type { CharacterOrigin } from "./character-origin";
import { GenerationCompanion } from "./generation-companion";
import "@tj/editor/styles/editor.css";

const KEY = ["first-experience-local-preview"] as const;
const saveLocally = async () => undefined;
/** `?first=6000` rehearses a slow first slide (real runs take 3–6 s). */
const FIRST_SLIDE_MS = Number(new URLSearchParams(window.location.search).get("first")) || 2600;

/** Local fixtures drive the production generating shell and editor; no transport is mounted. */
export function EditorPreview({
  onBack,
  onRestart,
  worksheetCount,
  characterOrigin,
  themeId,
}: {
  onBack: () => void;
  onRestart: () => void;
  worksheetCount: number;
  characterOrigin: CharacterOrigin | null;
  /** The lesson's starting theme (ruling 116): automatic, changed later in the slide rail. */
  themeId: string;
}) {
  const [client] = useState(() => {
    const cache = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const sample = demoLibrary()[0];
    if (!sample) throw new Error("Preview lesson missing");
    const lesson = { ...sample, themeId };
    cache.setQueryDefaults(KEY, { queryFn: async () => lesson });
    cache.setQueryData(KEY, lesson);
    return cache;
  });
  useEffect(() => {
    // StrictMode rehearses cleanup/setup; reseed only if that cleanup cleared our isolated cache.
    const sample = demoLibrary()[0];
    if (sample && !client.getQueryData(KEY)) {
      const lesson = { ...sample, themeId };
      // `clear()` drops the query defaults too: restore both, or the editor's queries have no queryFn.
      client.setQueryDefaults(KEY, { queryFn: async () => lesson });
      client.setQueryData(KEY, lesson);
    }
    return () => client.clear();
  }, [client, themeId]);
  return (
    <QueryClientProvider client={client}>
      <LocalEditor
        onBack={onBack}
        onRestart={onRestart}
        worksheetCount={worksheetCount}
        characterOrigin={characterOrigin}
      />
    </QueryClientProvider>
  );
}

function LocalEditor({
  onBack,
  onRestart,
  worksheetCount,
  characterOrigin,
}: {
  onBack: () => void;
  onRestart: () => void;
  worksheetCount: number;
  characterOrigin: CharacterOrigin | null;
}) {
  const { data: lesson } = useQuery<Lesson>({ queryKey: KEY });
  const [arrived, setArrived] = useState(0);
  const [ready, setReady] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [destination, setDestination] = useState<HTMLDivElement | null>(null);
  const [storyFinished, setStoryFinished] = useState(false);
  // The editor mounts hidden and is shown once its layout has settled (zoom-to-fit, toolbar), so
  // the swap from the generating shell moves nothing on screen (CLS).
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => setShown(true), 150);
      });
    });
    let timer = 0;
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [ready]);
  // Check stays with the finished lesson until the teacher starts working; its column closes on
  // that first input, so the canvas resizing is the teacher's own doing, not a shift.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const engage = () => setEngaged(true);
    const options = { capture: true, once: true } as const;
    window.addEventListener("pointerdown", engage, options);
    window.addEventListener("keydown", engage, options);
    return () => {
      window.removeEventListener("pointerdown", engage, options);
      window.removeEventListener("keydown", engage, options);
    };
  }, [shown]);
  const count = lesson?.slides.length ?? 0;
  useEffect(() => {
    if (stopped || ready) return;
    const timer = window.setTimeout(
      () => {
        if (arrived < count) setArrived(arrived + 1);
        else setReady(true);
      },
      arrived === 0 ? FIRST_SLIDE_MS : arrived === count ? 1800 : 2400,
    );
    return () => window.clearTimeout(timer);
  }, [arrived, count, ready, stopped]);
  if (!lesson) return null;
  const events: JobEvent[] = [
    JobEventSchema.parse({
      type: "progress",
      jobId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      at: lesson.createdAt,
      progress: {
        percent: 15 + Math.round((arrived / count) * 70),
        stage: "generate",
        message: `Slide ${Math.max(1, arrived)} of ${count}`,
      },
    }),
  ];
  const companionSlot = <div ref={setDestination} className="creation-generation-anchor" />;
  if (presenting) return <PresentView lesson={lesson} onExit={() => setPresenting(false)} />;
  return (
    <div
      className="creation-editor-preview"
      data-testid="creation-generating"
      data-preview-state={ready ? "ready" : arrived ? "partial" : "empty"}
      // The column closes on the teacher's first input (or at once if the story ended untouched
      // by motion); Check walks out of the overlay as it closes.
      data-story-finished={storyFinished || engaged}
    >
      <div className="creation-editor-surface">
        {ready ? (
          <div
            className={shown ? "creation-editor-live" : "creation-editor-staging"}
            inert={!shown}
          >
            <LessonEditor
              lessonId={lesson.id}
              queryKey={KEY}
              // An explicit queryFn: the editor passes its own (even undefined) over the defaults.
              queryFn={async () => lesson}
              onSave={saveLocally}
              onBack={onBack}
              onPresent={() => setPresenting(true)}
              initialSlideId={selected ?? lesson.slides.at(-1)?.id}
              companion={shown ? companionSlot : <div className="creation-generation-anchor" />}
            />
          </div>
        ) : null}
        {!shown ? (
          <GeneratingShell
            lesson={{ ...lesson, slides: lesson.slides.slice(0, arrived) }}
            events={events}
            onBack={onBack}
            onStop={() => setStopped(true)}
            stop={{ sent: stopped }}
            onViewSlide={setSelected}
            className="h-full"
            canvasCompanion={companionSlot}
          />
        ) : null}
      </div>
      {!storyFinished ? (
        <GenerationCompanion
          destination={destination}
          origin={characterOrigin}
          includedWorksheet={worksheetCount > 0}
          progress={count ? arrived / count : 0}
          ready={ready}
          paused={stopped}
          hold={!engaged}
          onExited={() => setStoryFinished(true)}
        />
      ) : null}
      <footer className="creation-editor-footer">
        <span>
          Local preview · sample lesson
          {worksheetCount
            ? ` · ${worksheetCount} worksheet${worksheetCount === 1 ? "" : "s"} selected`
            : ""}
        </span>
        <Button variant="link" size="sm" onClick={onBack}>
          Back to worksheets
        </Button>
        <Button variant="link" size="sm" onClick={onRestart}>
          Start again
        </Button>
      </footer>
    </div>
  );
}
