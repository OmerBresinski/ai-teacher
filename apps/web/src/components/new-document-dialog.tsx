import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tj/ui";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { NEW_DIALOG_DEFAULT_THEME_ID } from "@/lib/library-themes";

// The picker draws every theme with the slide renderer (decision 34): its own chunk, fetched when
// the dialog opens and drawn on the theme step.
const loadPicker = () => import("./new-document-theme-picker");
const ThemeStep = lazy(loadPicker);

/**
 * State lives for the life of the mount: callers render the dialog only while it is open (or give
 * it a fresh `key`), so every opening starts clean without a reset effect.
 */
export type NewDocumentValues = {
  title: string;
  themeId: string;
  yearGroup?: string;
  subject?: string;
  readingLevel?: string;
  language?: string;
  start: "starter" | "blank";
};

/**
 * Lessons only since TEACH-184: worksheets are made at `/worksheets/new`, and the brief's "Blank
 * lesson" is this dialog's one remaining door.
 */
export type NewDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: NewDocumentValues) => void | Promise<void>;
};

type Step = "about" | "theme";

/** TeachDeck's list (`components/library/year-groups.ts`): EYFS then Year 1–13; the label is stored. */
const YEAR_GROUPS = ["EYFS", ...Array.from({ length: 13 }, (_, index) => `Year ${index + 1}`)];
const READING_LEVELS = ["Below year group", "Same as year group", "Above year group"];
const LANGUAGES = [
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "cy", label: "Welsh" },
];

export function NewDocumentDialog({ open, onOpenChange, onCreate }: NewDocumentDialogProps) {
  const titleId = useId();
  const yearGroupId = useId();
  const subjectId = useId();
  const readingLevelId = useId();
  const languageId = useId();
  const [step, setStep] = useState<Step>("about");
  const [title, setTitle] = useState("");
  const [yearGroup, setYearGroup] = useState("");
  const [subject, setSubject] = useState("");
  const [readingLevel, setReadingLevel] = useState("");
  const [language, setLanguage] = useState("en-GB");
  const [themeId, setThemeId] = useState(NEW_DIALOG_DEFAULT_THEME_ID);
  const [start, setStart] = useState<"starter" | "blank">("starter");
  const [busy, setBusy] = useState(false);
  const noun = "lesson";
  const placeholder = "The water cycle";

  // Fetch the picker's chunk while the teacher fills in the first step.
  useEffect(() => {
    void loadPicker().catch(() => undefined);
  }, []);

  async function submit(): Promise<void> {
    if (busy || !themeId) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim() || `Untitled ${noun}`,
        themeId,
        yearGroup: yearGroup || undefined,
        subject: subject.trim() || undefined,
        readingLevel: readingLevel || undefined,
        language,
        start,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={step === "about" ? "lg" : "full"}
        className={step === "about" ? "max-w-[560px]" : "max-w-[1040px]"}
        dismissible={!busy}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{step === "about" ? `New ${noun}` : "Choose a theme"}</DialogTitle>
        </DialogHeader>

        {step === "about" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setStep("theme");
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId} className="!text-foreground">
                Title
              </Label>
              <Input
                id={titleId}
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={placeholder}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id={yearGroupId}
                label="Year group"
                value={yearGroup}
                onValueChange={setYearGroup}
                placeholder="Not set"
                items={YEAR_GROUPS}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={subjectId} className="!text-foreground">
                  Subject
                </Label>
                <Input
                  id={subjectId}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Science"
                />
              </div>
              <SelectField
                id={readingLevelId}
                label="Reading level"
                value={readingLevel}
                onValueChange={setReadingLevel}
                placeholder="Same as year group"
                items={READING_LEVELS}
              />
              <SelectField
                id={languageId}
                label="Language"
                value={language}
                onValueChange={setLanguage}
                items={LANGUAGES}
              />
            </div>
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
          </form>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            <Suspense fallback={<Skeleton className="h-[min(66vh,580px)] w-full rounded-card" />}>
              <ThemeStep
                selectedId={themeId}
                onPick={setThemeId}
                title={title.trim() || `Untitled ${noun}`}
              />
            </Suspense>
            <div className="flex flex-col gap-1.5">
              <Label className="!text-foreground">Start from</Label>
              <Tabs value={start} onValueChange={(value) => setStart(value as "starter" | "blank")}>
                <TabsList aria-label="Start from">
                  <TabsTrigger value="starter" onClick={() => setStart("starter")}>
                    Starter lesson
                  </TabsTrigger>
                  <TabsTrigger value="blank" onClick={() => setStart("blank")}>
                    Blank
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="starter" forceMount className="hidden" />
                <TabsContent value="blank" forceMount className="hidden" />
              </Tabs>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "about" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setStep("theme")}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setStep("about")}>
                Back
              </Button>
              <Button variant="primary" disabled={busy || !themeId} onClick={() => void submit()}>
                {busy ? <Spinner /> : null}
                Create {noun}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  items,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  items: (string | { value: string; label: string })[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="!text-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-full data-[placeholder]:!text-foreground">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectGroup>
            {items.map((item) => {
              const value = typeof item === "string" ? item : item.value;
              const label = typeof item === "string" ? item : item.label;
              return (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
