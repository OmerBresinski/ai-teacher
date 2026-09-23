import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { Lesson } from "@tj/domain/documents";
import { type JobEvent, JobEventSchema } from "@tj/domain/jobs";
import { LessonEditor } from "@tj/editor/lesson";
import { PresentView } from "@tj/editor/present";
import { demoLibrary } from "@tj/editor/starter";
import { Button } from "@tj/ui";
import { useEffect, useState } from "react";
import { GeneratingShell } from "@/components/generating-lesson/GeneratingShell";
import { GenerationCompanion } from "./generation-companion";
import "@tj/editor/styles/editor.css";

const KEY = ["first-experience-local-preview"] as const;
const saveLocally = async () => undefined;

/** Local fixtures drive the production generating shell and editor; no transport is mounted. */
export function EditorPreview({
  onBack,
  onRestart,
  worksheetCount,
}: {
  onBack: () => void;
  onRestart: () => void;
  worksheetCount: number;
}) {
  const [client] = useState(() => {
    const cache = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    const lesson = demoLibrary()[0];
    if (!lesson) throw new Error("Preview lesson missing");
    cache.setQueryDefaults(KEY, { queryFn: async () => lesson });
    cache.setQueryData(KEY, lesson);
    return cache;
  });
  useEffect(() => {
    // StrictMode rehearses cleanup/setup; reseed only if that cleanup cleared our isolated cache.
    if (!client.getQueryData(KEY)) client.setQueryData(KEY, demoLibrary()[0]);
    return () => client.clear();
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <LocalEditor onBack={onBack} onRestart={onRestart} worksheetCount={worksheetCount} />
    </QueryClientProvider>
  );
}

function LocalEditor({
  onBack,
  onRestart,
  worksheetCount,
}: {
  onBack: () => void;
  onRestart: () => void;
  worksheetCount: number;
}) {
  const { data: lesson } = useQuery<Lesson>({ queryKey: KEY });
  const [arrived, setArrived] = useState(0);
  const [ready, setReady] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [destination, setDestination] = useState<HTMLDivElement | null>(null);
  const [storyFinished, setStoryFinished] = useState(false);
  const count = lesson?.slides.length ?? 0;
  useEffect(() => {
    if (stopped || ready) return;
    const timer = window.setTimeout(
      () => {
        if (arrived < count) setArrived(arrived + 1);
        else setReady(true);
      },
      arrived === 0 ? 2600 : arrived === count ? 1800 : 2400,
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
      data-story-finished={storyFinished}
    >
      <div className="creation-editor-surface">
        {ready ? (
          <LessonEditor
            lessonId={lesson.id}
            queryKey={KEY}
            onSave={saveLocally}
            onBack={onBack}
            onPresent={() => setPresenting(true)}
            initialSlideId={selected ?? lesson.slides.at(-1)?.id}
            companion={companionSlot}
          />
        ) : (
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
        )}
      </div>
      {!storyFinished ? (
        <GenerationCompanion
          destination={destination}
          includedWorksheet={worksheetCount > 0}
          progress={count ? arrived / count : 0}
          ready={ready}
          paused={stopped}
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
