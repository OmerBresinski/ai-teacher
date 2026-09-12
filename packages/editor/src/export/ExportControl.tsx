import type { Lesson, Worksheet } from "@tj/domain/documents";
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  toast,
} from "@tj/ui";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Segmented } from "../kit/Segmented";
import { downloadLessonJSON, downloadWorksheetJSON } from "./json";
import { type PrintLayout, printViewHref, worksheetPrintHref } from "./pdf";
import { ALL_SLIDES, parseSlideRange } from "./range";

/**
 * The export dialog (TeachDeck `components/v2/export/ExportControl.tsx`; ADR 0023 §3–§7). One
 * control for lessons and worksheets: a format tab strip over that format's options and one
 * "Export …" button. E1 ships PDF (the print route in a new tab) and JSON; the PPTX, PNG and DOCX
 * tabs are present but disabled until E2 / E3 land them (ADR 0023 §5), each adding a `case` to the
 * one `switch (format)` in `run()` and an `await import()` of its exporter.
 *
 * Opening the print tab is the app's job (`onOpenPrint`): the package never touches `window.open`
 * or knows an origin (ADR 0022 §6). The click on Export is the user gesture browsers require for
 * `window.open`, so `run()` opens before it does anything asynchronous. E2 adds `imageOrigin`
 * (TEACH-272 §8), the api origin that decides `credentials` per image; nothing in E1 fetches one.
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

type FormatTab = { value: ExportFormat; label: string; disabled?: boolean };

const LESSON_FORMATS: FormatTab[] = [
  { value: "pdf", label: "PDF" },
  { value: "pptx", label: "PowerPoint", disabled: true },
  { value: "png", label: "PNG", disabled: true },
  { value: "json", label: "JSON" },
];

const WORKSHEET_FORMATS: FormatTab[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word", disabled: true },
  { value: "json", label: "JSON" },
];

export const PENDING_FORMAT_TIP = "Arrives in the next export phase";

const isWorksheet = (document: Lesson | Worksheet): document is Worksheet => "blocks" in document;

export function ExportControl({ document, currentSlideId, onOpenPrint }: ExportControlProps) {
  const worksheet = isWorksheet(document);
  const formats = worksheet ? WORKSHEET_FORMATS : LESSON_FORMATS;
  const slideCount = worksheet ? 0 : document.slides.length;
  const hasQuestions = !worksheet && document.slides.some((s) => !!s.question);
  // The range field says All, so "this slide" gets its one click back as a button beside the hint
  // that fills the field with the number below. Seeding the field with it would quietly change what
  // Export PDF does to the whole deck.
  const currentIndex =
    !worksheet && currentSlideId ? document.slides.findIndex((s) => s.id === currentSlideId) : -1;
  const currentNumber = currentIndex >= 0 ? currentIndex + 1 : null;

  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  // ALL_SLIDES as a real value, not a placeholder: "All" IS the current setting.
  const [slides, setSlides] = useState(ALL_SLIDES);
  const [layout, setLayout] = useState<PrintLayout>("slides");
  const [answers, setAnswers] = useState(false);
  const [notes, setNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = parseSlideRange(slides, slideCount);
  const rangeError = range.ok ? null : range.error;
  // Only PDF (and, from E2, PNG) read the range; the other formats take the whole document.
  const rangeApplies = !worksheet && format === "pdf";
  const empty = rangeApplies && range.ok && range.indices.length === 0;
  const blocked = (rangeApplies && !!rangeError) || empty;

  const finish = (message: string) => {
    setOpen(false);
    toast(message);
  };

  const run = () => {
    setError(null);
    if (rangeApplies) {
      if (!range.ok) {
        setError(range.error);
        return;
      }
      // A lesson with no slides parses as a valid empty range: nothing to print.
      if (range.indices.length === 0) {
        setError("There is nothing to export.");
        return;
      }
    }
    switch (format) {
      case "pdf": {
        // Synchronous: the click is the gesture the browser lets open a tab.
        onOpenPrint(
          worksheet
            ? worksheetPrintHref(document.id)
            : printViewHref(document.id, {
                answers,
                notes: layout === "slides" && notes,
                layout,
                slides,
              }),
        );
        finish("Opened the print view");
        return;
      }
      case "json": {
        if (worksheet) downloadWorksheetJSON(document);
        else downloadLessonJSON(document);
        finish(worksheet ? "Worksheet exported as JSON" : "Lesson exported as JSON");
        return;
      }
      default:
        // PPTX, PNG and DOCX arrive with E2 / E3; their tabs cannot be selected until then.
        return;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Export
          <ChevronDown aria-hidden size={16} strokeWidth={1.5} />
        </Button>
      </DialogTrigger>
      <DialogContent size="md" data-export-dialog>
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
            {formats.map((tab) =>
              tab.disabled ? (
                // A disabled Radix trigger has no pointer events, so the tooltip hangs off a
                // wrapper that still receives the hover (the placeholder buttons' pattern).
                <Tooltip key={tab.value} label={PENDING_FORMAT_TIP}>
                  <span className="flex-1">
                    <TabsTrigger value={tab.value} disabled className="w-full">
                      {tab.label}
                    </TabsTrigger>
                  </span>
                </Tooltip>
              ) : (
                <TabsTrigger key={tab.value} value={tab.value} className="flex-1">
                  {tab.label}
                </TabsTrigger>
              ),
            )}
          </TabsList>

          {/* One height for the formats with options, so switching between them does not walk
              the Export button up and down the screen; JSON has none and collapses. */}
          <TabsContent value="pdf" className="flex min-h-[180px] flex-col gap-3 pt-2">
            {worksheet ? (
              <Note>
                The sheet prints at its saved page size. The answer key follows the worksheet's own
                setting.
              </Note>
            ) : (
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
            )}
          </TabsContent>
          <TabsContent value="json" className="pt-2">
            <Note>
              The whole {worksheet ? "worksheet" : "lesson"} as it is stored, including the facts
              and notes. Import it back from the library.
            </Note>
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center sm:justify-between">
          <span
            role="status"
            className={cn("min-w-0 truncate text-meta", error ? "text-destructive" : "text-ink-3")}
          >
            {error}
          </span>
          <Button variant="primary" size="sm" disabled={blocked} onClick={run}>
            {ACTION_LABEL[format]}
          </Button>
        </DialogFooter>
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

function OptionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-meta font-medium text-ink-2">{label}</span>
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
