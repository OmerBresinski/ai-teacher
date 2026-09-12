import type { Lesson, Worksheet } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  toast,
} from "@tj/ui";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Segmented } from "../kit/Segmented";
import { getTheme } from "../model/themes";
import { SlideView } from "../slide/SlideView";
import { downloadBlob } from "./download";
import { downloadLessonJSON, downloadWorksheetJSON } from "./json";
import { waitForSlidePaint } from "./paint";
import { type PrintLayout, printViewHref, worksheetPrintHref } from "./pdf";
import type { PngScale } from "./png";
import { ALL_SLIDES, parseSlideRange } from "./range";

/**
 * The export dialog (TeachDeck `components/v2/export/ExportControl.tsx`; ADR 0023 §3–§7). One
 * control for lessons and worksheets: a format tab strip over that format's options and one
 * "Export …" button. E1 shipped PDF (the print route in a new tab) and JSON; E2 adds PowerPoint and
 * PNG for lessons and E3 Word for worksheets, each loaded with `await import()` on click (ADR 0023
 * §4) from its own `case` in the one `switch (format)` in `run()`.
 *
 * Opening the print tab is the app's job (`onOpenPrint`): the package never touches `window.open`
 * or knows an origin (ADR 0022 §6). The click on Export is the user gesture browsers require for
 * `window.open`, so the PDF case opens before anything asynchronous. `imageOrigin` is the api origin
 * (TEACH-272 §8): the exporters send the session cookie to it and to nothing else.
 *
 * PNG capture (ADR 0023 §3) mounts one slide at a time on an offscreen stage inside this control,
 * waits for its paint, rasterises it and downloads it, with a 120 ms gap between files so the
 * browser does not drop back-to-back downloads. The loop reads a cancel ref; closing the dialog
 * sets it, so the run stops after the file in hand. The stage is mounted with `flushSync` so the
 * loop can await `waitForSlidePaint` on the real element — no readiness effect.
 *
 * Option state is local `useState`: the dialog is transient chrome, not document state (ADR 0022
 * §4). `answers` defaults to off for every format alike — TeachDeck shipped PPTX defaulting to on
 * while PDF and PNG were off (TD item 4); the one default is the fix (ADR 0023 §7).
 */
export type ExportFormat = "pdf" | "pptx" | "png" | "docx" | "json";

export type ExportControlProps = {
  document: Lesson | Worksheet;
  /** The slide the surface is showing, behind the range field's "This slide". */
  currentSlideId?: string;
  /** The api origin (`${VITE_API_URL}`): image fetches to it carry the session cookie (§1). */
  imageOrigin?: string;
  /** Open the print route (a same-origin path) in a new tab; the app owns `window.open`. */
  onOpenPrint: (href: string) => void;
};

const ACTION_LABEL: Record<ExportFormat, string> = {
  pdf: "Export PDF",
  pptx: "Export PowerPoint",
  png: "Export PNG",
  docx: "Export Word",
  json: "Export JSON",
};

type FormatTab = { value: ExportFormat; label: string };

const LESSON_FORMATS: FormatTab[] = [
  { value: "pdf", label: "PDF" },
  { value: "pptx", label: "PowerPoint" },
  { value: "png", label: "PNG" },
  { value: "json", label: "JSON" },
];

const WORKSHEET_FORMATS: FormatTab[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "json", label: "JSON" },
];

/** TeachDeck's one-line caveat on the PowerPoint tab (ADR 0023 §7): fonts go by family name. */
export const PPTX_FONT_NOTE =
  "Uses the theme's fonts by name; install them for full fidelity, or PowerPoint substitutes.";
export const EXPORT_FAILED = "That export did not finish. Try again.";
/** Browsers drop downloads fired back to back; give each one room (TeachDeck's gap). */
const DOWNLOAD_GAP_MS = 120;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isWorksheet = (document: Lesson | Worksheet): document is Worksheet => "blocks" in document;

/**
 * The click-loaded exporter modules (ADR 0023 §4). One object so a unit test can swap an entry
 * for a stub and put it back, without `mock.module`, which would leak into the exporters' own
 * tests in the same run; the `import()` calls stay literal so Vite still splits the chunks.
 */
export const exportLoaders = {
  pptx: () => import("./pptx"),
  png: () => import("./png"),
  docx: () => import("./docx"),
};

/** A live export. `cancellable` is the truth about the exporter, not a wish. */
type Run = { label: string; cancellable: boolean };

export function ExportControl({
  document,
  currentSlideId,
  imageOrigin,
  onOpenPrint,
}: ExportControlProps) {
  const worksheet = isWorksheet(document);
  const lesson = worksheet ? null : document;
  const formats = worksheet ? WORKSHEET_FORMATS : LESSON_FORMATS;
  const slideCount = lesson ? lesson.slides.length : 0;
  const hasQuestions = !!lesson && lesson.slides.some((s) => !!s.question);
  // The range field says All, so "this slide" gets its one click back as a button beside the hint
  // that fills the field with the number below. Seeding the field with it would quietly change what
  // Export PDF does to the whole deck.
  const currentIndex =
    lesson && currentSlideId ? lesson.slides.findIndex((s) => s.id === currentSlideId) : -1;
  const currentNumber = currentIndex >= 0 ? currentIndex + 1 : null;

  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  // ALL_SLIDES as a real value, not a placeholder: "All" IS the current setting.
  const [slides, setSlides] = useState(ALL_SLIDES);
  const [layout, setLayout] = useState<PrintLayout>("slides");
  const [answers, setAnswers] = useState(false);
  const [notes, setNotes] = useState(false);
  const [pngScale, setPngScale] = useState<PngScale>(2);
  // Word keeps the worksheet's own answer-key setting as its default (ADR 0023 §7).
  const [answerKey, setAnswerKey] = useState(worksheet ? document.includeAnswerKey : false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  /** The slide on the offscreen stage, by index; `null` between and after runs. */
  const [staged, setStaged] = useState<number | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  const range = parseSlideRange(slides, slideCount);
  const rangeError = range.ok ? null : range.error;
  // PDF and PNG read the range; PowerPoint and JSON take the whole document.
  const rangeApplies = !!lesson && (format === "pdf" || format === "png");
  const empty = rangeApplies && range.ok && range.indices.length === 0;
  const blocked = (rangeApplies && !!rangeError) || empty || !!run;

  const close = () => {
    setOpen(false);
    setError(null);
    cancelRef.current = true;
  };
  const finish = (message: string) => {
    setOpen(false);
    toast(message);
  };

  /** One slide on the stage, painted: `flushSync` mounts it, `waitForSlidePaint` sees it land. */
  const stageSlide = async (index: number): Promise<HTMLElement> => {
    flushSync(() => setStaged(index));
    const el = stageRef.current?.querySelector<HTMLElement>("[data-slide-root]");
    if (!el) throw new Error("The slide could not be prepared for capture.");
    await waitForSlidePaint(el);
    return el;
  };

  const exportPptx = async (deck: Lesson) => {
    // pptxgenjs builds the whole file in one call: there is nothing to stop.
    setRun({ label: "Building the PowerPoint file", cancellable: false });
    const { exportLessonPptx, pptxFilename } = await exportLoaders.pptx();
    const blob = await exportLessonPptx(deck, getTheme(deck.themeId), {
      includeAnswers: answers,
      imageOrigin,
    });
    downloadBlob(blob, pptxFilename(deck));
    finish("Lesson exported as PowerPoint");
  };

  const exportDocx = async (sheet: Worksheet) => {
    // `docx` packs the whole file in one call: there is nothing to stop.
    setRun({ label: "Building the Word file", cancellable: false });
    const { worksheetDocxBlob, docxFilename } = await exportLoaders.docx();
    const blob = await worksheetDocxBlob(sheet, { includeAnswerKey: answerKey, imageOrigin });
    downloadBlob(blob, docxFilename(sheet));
    finish("Worksheet exported as Word");
  };

  const exportPng = async (deck: Lesson, indices: number[]) => {
    const { captureSlidePng, pngFilename } = await exportLoaders.png();
    const total = indices.length;
    let failed = 0;
    for (let n = 0; n < total; n += 1) {
      const index = indices[n];
      if (index === undefined) continue;
      if (cancelRef.current) {
        toast("Export stopped");
        return;
      }
      setRun({
        label: total > 1 ? `Exporting ${n + 1} of ${total}` : "Saving the image",
        cancellable: true,
      });
      try {
        const el = await stageSlide(index);
        if (cancelRef.current) {
          toast("Export stopped");
          return;
        }
        const blob = await captureSlidePng(el, pngScale, imageOrigin);
        downloadBlob(blob, pngFilename(deck, index));
      } catch {
        // One slide that will not rasterise (a tainted picture, a timeout) must not lose the rest.
        failed += 1;
        toast(`Slide ${index + 1} could not be exported`);
      }
      if (n < total - 1) await wait(DOWNLOAD_GAP_MS);
    }
    const done = total - failed;
    if (done === 0) throw new Error(EXPORT_FAILED);
    finish(done > 1 ? `${done} slides exported as PNG` : "Lesson exported as PNG");
  };

  const run_ = async () => {
    if (run) return;
    setError(null);
    // Armed before the first await, so a close during the exporter's own `import()` still stops
    // the run rather than being wiped by a reset that came after it.
    cancelRef.current = false;
    if (rangeApplies) {
      if (!range.ok) {
        setError(range.error);
        return;
      }
      // A lesson with no slides parses as a valid empty range: nothing to export.
      if (range.indices.length === 0) {
        setError("There is nothing to export.");
        return;
      }
    }
    try {
      switch (format) {
        case "pdf": {
          // Synchronous: the click is the gesture the browser lets open a tab.
          onOpenPrint(
            lesson
              ? printViewHref(lesson.id, {
                  answers,
                  notes: layout === "slides" && notes,
                  layout,
                  slides,
                })
              : worksheetPrintHref(document.id),
          );
          finish("Opened the print view");
          return;
        }
        case "json": {
          if (lesson) downloadLessonJSON(lesson);
          else downloadWorksheetJSON(document as Worksheet);
          finish(lesson ? "Lesson exported as JSON" : "Worksheet exported as JSON");
          return;
        }
        case "pptx": {
          if (lesson) await exportPptx(lesson);
          return;
        }
        case "png": {
          if (lesson && range.ok) await exportPng(lesson, range.indices);
          return;
        }
        case "docx": {
          if (worksheet) await exportDocx(document as Worksheet);
          return;
        }
        default:
          return;
      }
    } catch {
      setError(EXPORT_FAILED);
    } finally {
      setRun(null);
      setStaged(null);
      cancelRef.current = false;
    }
  };

  const stagedSlide = lesson && staged !== null ? lesson.slides[staged] : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Export
          <ChevronDown aria-hidden size={16} strokeWidth={1.5} />
        </Button>
      </DialogTrigger>
      {/* A run that cannot be stopped (the PowerPoint build) keeps its dialog until it is done; a
          PNG run can be cancelled, and closing is how it is. */}
      <DialogContent
        size="md"
        data-export-dialog
        dismissible={!run || run.cancellable}
        showCloseButton={!run || run.cancellable}
      >
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            {worksheet
              ? "Save this worksheet as a file to print or share."
              : "Save this lesson as a file to print or share."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
          <TabsList aria-label="Format" className="w-full">
            {formats.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-1">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* One height for the formats with options, so switching between them does not walk
              the Export button up and down the screen; JSON has none and collapses. */}
          <TabsContent value="pdf" className="flex min-h-[180px] flex-col gap-3 pt-2">
            {lesson ? (
              <>
                <RangeField
                  value={slides}
                  onChange={setSlides}
                  error={rangeError}
                  count={slideCount}
                  current={currentNumber}
                />
                <OptionRow label="Pages">
                  <Segmented
                    aria-label="Pages"
                    value={layout}
                    onChange={setLayout}
                    options={[
                      { value: "slides", label: "One per page" },
                      { value: "handout3", label: "3 per page" },
                    ]}
                  />
                </OptionRow>
                {hasQuestions ? (
                  <SwitchRow label="Include answers" checked={answers} onChange={setAnswers} />
                ) : null}
                {layout === "slides" ? (
                  <SwitchRow label="Include presenter notes" checked={notes} onChange={setNotes} />
                ) : (
                  <Note>A4, with note lines beside each slide.</Note>
                )}
              </>
            ) : (
              <Note>
                The sheet prints at its saved page size. The answer key follows the worksheet's own
                setting.
              </Note>
            )}
          </TabsContent>
          {lesson ? (
            <>
              <TabsContent value="pptx" className="flex min-h-[180px] flex-col gap-3 pt-2">
                {/* One verb for answers across every format. What the toggle builds differs by
                    format; what the teacher asks for does not. */}
                <SwitchRow label="Include answers" checked={answers} onChange={setAnswers} />
                <Note>
                  Each reveal step becomes its own slide, so clicking through still works.
                </Note>
                {answers ? (
                  <Note>
                    Correct answers are marked, and listed on a slide of their own at the end.
                  </Note>
                ) : null}
                <Note>{PPTX_FONT_NOTE}</Note>
              </TabsContent>
              <TabsContent value="png" className="flex min-h-[180px] flex-col gap-3 pt-2">
                <RangeField
                  value={slides}
                  onChange={setSlides}
                  error={rangeError}
                  count={slideCount}
                  current={currentNumber}
                />
                <OptionRow label="Size" hint={`${SLIDE_W * pngScale} x ${SLIDE_H * pngScale}`}>
                  <Segmented
                    aria-label="Size"
                    value={String(pngScale)}
                    onChange={(v) => setPngScale(Number(v) as PngScale)}
                    options={[
                      { value: "1", label: "1x" },
                      { value: "2", label: "2x" },
                      { value: "3", label: "3x" },
                    ]}
                  />
                </OptionRow>
                {hasQuestions ? (
                  <SwitchRow label="Include answers" checked={answers} onChange={setAnswers} />
                ) : null}
                {range.ok && range.indices.length > 1 ? (
                  <Note>{range.indices.length} files download one after another.</Note>
                ) : null}
              </TabsContent>
            </>
          ) : null}
          {worksheet ? (
            <TabsContent value="docx" className="flex min-h-[180px] flex-col gap-3 pt-2">
              <SwitchRow label="Include answer key" checked={answerKey} onChange={setAnswerKey} />
              <Note>
                Every question, box and line as real Word text and tables, in Calibri. The answer
                key goes on a page of its own at the end.
              </Note>
            </TabsContent>
          ) : null}
          <TabsContent value="json" className="pt-2">
            <Note>
              The whole {worksheet ? "worksheet" : "lesson"} as it is stored, including the facts
              and notes. Import it back from the library.
            </Note>
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center sm:justify-between">
          {/* The live region is the label alone: wrapping the spinner and Cancel in it would
              re-announce "Cancel" on every step of a multi-slide run. */}
          <span
            className={cn(
              "flex min-w-0 items-center gap-2 text-meta",
              error ? "text-destructive" : "text-ink-3",
            )}
          >
            {run ? <Spinner size={16} /> : null}
            <output aria-live="polite" className="truncate">
              {run ? run.label : error}
            </output>
            {run?.cancellable ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="h-6 shrink-0 px-2"
              >
                Cancel
              </Button>
            ) : null}
          </span>
          <Button variant="primary" size="sm" disabled={blocked} onClick={() => void run_()}>
            {ACTION_LABEL[format]}
          </Button>
        </DialogFooter>

        {/* Offscreen capture stage (ADR 0023 §3): exactly one slide at a time, never visible.
            Inside the dialog so it is unmounted with it; off-canvas rather than `display: none`,
            which would give the rasteriser nothing to paint. */}
        {stagedSlide && lesson ? (
          <div
            ref={stageRef}
            aria-hidden
            data-capture-stage
            style={{
              position: "fixed",
              left: -10000,
              top: 0,
              width: SLIDE_W,
              height: SLIDE_H,
              pointerEvents: "none",
            }}
          >
            <SlideView
              slide={stagedSlide}
              theme={getTheme(lesson.themeId)}
              mode="capture"
              revealAnswer={answers && !!stagedSlide.question}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function RangeField({
  value,
  onChange,
  error,
  count,
  current,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  count: number;
  current: number | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
      <Label htmlFor={id}>Slides</Label>
      <Input
        id={id}
        aria-describedby={hintId}
        aria-invalid={error ? true : undefined}
        value={value}
        placeholder={ALL_SLIDES}
        // The field arrives holding "All". Selecting it on focus means typing a range still takes
        // one gesture, the way a print dialog's page field does.
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
      <span />
      <span id={hintId} className={cn("text-meta", error ? "text-destructive" : "text-ink-3")}>
        {error ?? (
          <>
            {`1 to ${count}`}
            {current ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => onChange(String(current))}
                  className="underline decoration-current/40 underline-offset-2 hover:text-foreground"
                >
                  This slide
                </button>
              </>
            ) : null}
          </>
        )}
      </span>
    </div>
  );
}

function OptionRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-baseline gap-2">
        <span className="text-meta font-medium text-ink-2">{label}</span>
        {hint ? <span className="text-meta text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-body">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 text-meta text-ink-3">{children}</p>;
}
