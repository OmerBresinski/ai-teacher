import { Button } from "@tj/ui";
import { FileText, Paperclip, X } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CreationShell } from "@/components/lesson-creation/creation-shell";
import {
  BriefStep,
  type IntakeBrief,
  type ObjectiveDraft,
  ObjectivesStep,
  type WorksheetDraft,
  WorksheetStep,
} from "@/components/lesson-creation/step-fields";

const loadEditorPreview = () =>
  import("@/components/lesson-creation/editor-preview").then((m) => ({ default: m.EditorPreview }));
const EditorPreview = lazy(loadEditorPreview);

type Stage = "brief" | "objectives" | "worksheet" | "generating";
const TITLES: Record<Stage, string> = {
  brief: "Let’s start with your idea.",
  objectives: "Learning objectives",
  worksheet: "Something to practise with?",
  generating: "Your lesson is coming together.",
};
const OBJECTIVES: ObjectiveDraft[] = [
  { id: "o1", text: "Describe evaporation, condensation and precipitation." },
  { id: "o2", text: "Explain how water moves through the water cycle." },
  { id: "o3", text: "Use the water cycle to explain where rain comes from." },
];

/** Local visual fixture composing the same callback-driven components used by the app.
 * It deliberately never calls auth, upload, planning or generation endpoints. */
export function DevFirstExperiencePage() {
  useLayoutEffect(() => {
    // This isolated art-direction preview does not change saved app preferences.
    const html = document.documentElement;
    const design = html.getAttribute("data-design");
    const theme = html.getAttribute("data-theme");
    const apply = () => {
      html.setAttribute("data-design", "lessonco");
      html.setAttribute("data-theme", "light");
    };
    apply();
    // The app ThemeProvider applies its stored preference in a passive mount effect.
    const frame = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(frame);
      if (design === null) html.removeAttribute("data-design");
      else html.setAttribute("data-design", design);
      if (theme === null) html.removeAttribute("data-theme");
      else html.setAttribute("data-theme", theme);
    };
  }, []);

  const [stage, setStage] = useState<Stage>("brief");
  useEffect(() => {
    if (stage === "objectives" || stage === "worksheet") void loadEditorPreview();
  }, [stage]);
  const [brief, setBrief] = useState<IntakeBrief>({
    topic: "The water cycle",
    yearGroup: "Year 5",
    level: "standard",
    files: [],
  });
  const [objectives, setObjectives] = useState(OBJECTIVES);
  const [slideCount, setSlideCount] = useState("7");
  const [duration, setDuration] = useState("60");
  const [worksheets, setWorksheets] = useState<WorksheetDraft[]>([
    { id: "sheet-1", recipe: "knowledge-check", minutes: "10" },
  ]);
  const [includeWorksheets, setIncludeWorksheets] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const transition = useRef<ViewTransition | null>(null);
  function go(next: Stage) {
    transition.current?.skipTransition();
    const update = () => {
      flushSync(() => setStage(next));
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    if (
      document.startViewTransition &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      transition.current = document.startViewTransition(update);
    } else update();
  }
  const picker = (
    <div className="creation-upload">
      <input
        className="sr-only"
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.pptx,.docx"
        aria-label="Choose source files"
        onChange={(event) => {
          const names = Array.from(event.target.files ?? []).map((file) => file.name);
          setBrief((current) => ({
            ...current,
            files: [...new Set([...current.files, ...names])].slice(0, 3),
          }));
          event.target.value = "";
        }}
      />
      {brief.files.map((name) => (
        <div key={name} className="flex items-center gap-2">
          <FileText size={16} />
          <span className="truncate">{name}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${name}`}
            onClick={() =>
              setBrief((current) => ({
                ...current,
                files: current.files.filter((file) => file !== name),
              }))
            }
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="link"
        onClick={() => fileInput.current?.click()}
        disabled={brief.files.length >= 3}
      >
        <Paperclip /> Add a file
      </Button>
      {brief.files.length ? (
        <p className="text-meta text-muted-foreground">Preview only — files stay on your device.</p>
      ) : null}
    </div>
  );
  if (stage === "generating")
    return (
      <Suspense fallback={<div className="creation-shell">Opening your lesson…</div>}>
        <EditorPreview
          onBack={() => go("worksheet")}
          onRestart={() => go("brief")}
          worksheetCount={includeWorksheets ? worksheets.length : 0}
        />
      </Suspense>
    );
  return (
    <>
      <CreationShell stage={stage} title={TITLES[stage]}>
        {stage === "brief" ? (
          <BriefStep
            brief={brief}
            onChange={setBrief}
            onNext={() => go("objectives")}
            onSkip={() => go("worksheet")}
            filePicker={picker}
          />
        ) : null}
        {stage === "objectives" ? (
          <ObjectivesStep
            brief={brief}
            objectives={objectives}
            onChange={setObjectives}
            slideCount={slideCount}
            duration={duration}
            onSlideCount={setSlideCount}
            onDuration={setDuration}
            onBack={() => go("brief")}
            onGenerate={() => go("worksheet")}
          />
        ) : null}
        {stage === "worksheet" ? (
          <WorksheetStep
            worksheets={worksheets}
            onChange={setWorksheets}
            onBack={() => go("objectives")}
            onMake={() => {
              setIncludeWorksheets(true);
              go("generating");
            }}
            onSkip={() => {
              setIncludeWorksheets(false);
              go("generating");
            }}
          />
        ) : null}
      </CreationShell>
      <footer className="creation-preview-label">Design preview · local sample content</footer>
    </>
  );
}
