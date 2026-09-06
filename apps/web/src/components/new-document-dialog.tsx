import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tj/ui";
import { useId, useMemo, useState } from "react";
import { LIBRARY_THEMES } from "@/mocks/library-fixtures";

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

export type NewDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "lesson" | "worksheet";
  onCreate: (values: NewDocumentValues) => void | Promise<void>;
};

type Step = "about" | "theme";
type ThemeTag = "All" | "Primary" | "Secondary" | "Calm" | "Bold";

/** TeachDeck's list (`components/library/year-groups.ts`): EYFS then Year 1–13; the label is stored. */
const YEAR_GROUPS = ["EYFS", ...Array.from({ length: 13 }, (_, index) => `Year ${index + 1}`)];
const THEME_TAGS: ThemeTag[] = ["All", "Primary", "Secondary", "Calm", "Bold"];
const READING_LEVELS = ["Below year group", "Same as year group", "Above year group"];
const LANGUAGES = [
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "cy", label: "Welsh" },
];
const THEMES_BY_ID = new Map(LIBRARY_THEMES.map((theme) => [theme.id, theme]));

export function NewDocumentDialog({ open, onOpenChange, kind, onCreate }: NewDocumentDialogProps) {
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
  const [themeId, setThemeId] = useState(LIBRARY_THEMES[0]?.id ?? "");
  const [themeTag, setThemeTag] = useState<ThemeTag>("All");
  const [start, setStart] = useState<"starter" | "blank">("starter");
  const [busy, setBusy] = useState(false);
  const noun = kind === "lesson" ? "lesson" : "worksheet";
  const placeholder = kind === "lesson" ? "The water cycle" : "Fractions practice";

  const themes = useMemo(
    () =>
      themeTag === "All"
        ? LIBRARY_THEMES
        : LIBRARY_THEMES.filter((theme) => theme.tags.includes(themeTag)),
    [themeTag],
  );

  function selectThemeTag(value: string): void {
    const next = value as ThemeTag;
    setThemeTag(next);
    if (next !== "All" && !THEMES_BY_ID.get(themeId)?.tags.includes(next)) setThemeId("");
  }

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
        size="lg"
        className="max-w-[560px]"
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
          <div className="flex flex-col gap-4">
            <Tabs value={themeTag} onValueChange={selectThemeTag}>
              <TabsList aria-label="Theme category" className="max-w-full overflow-x-auto">
                {THEME_TAGS.map((tag) => (
                  <TabsTrigger key={tag} value={tag} onClick={() => selectThemeTag(tag)}>
                    {tag}
                  </TabsTrigger>
                ))}
              </TabsList>
              {THEME_TAGS.map((tag) => (
                <TabsContent key={tag} value={tag} forceMount className="hidden" />
              ))}
            </Tabs>
            <RadioGroup
              aria-label="Theme"
              value={themeId}
              onValueChange={setThemeId}
              className="grid max-h-[min(52vh,420px)] grid-cols-3 gap-3 overflow-y-auto p-0.5"
            >
              {themes.map((theme) => (
                <RadioGroupItem
                  key={theme.id}
                  value={theme.id}
                  aria-label={theme.name}
                  className="h-auto w-full aspect-auto rounded-card border p-0 text-left data-[state=checked]:ring-2 data-[state=checked]:ring-ring"
                >
                  <span
                    className="block aspect-video w-full rounded-t-card"
                    style={{ backgroundColor: theme.swatch }}
                  />
                  <span className="block truncate px-2 py-1.5 text-body font-medium">
                    {theme.name}
                  </span>
                </RadioGroupItem>
              ))}
            </RadioGroup>
            {kind === "lesson" ? (
              <div className="flex flex-col gap-1.5">
                <Label className="!text-foreground">Start from</Label>
                <Tabs
                  value={start}
                  onValueChange={(value) => setStart(value as "starter" | "blank")}
                >
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
            ) : null}
          </div>
        )}

        <DialogFooter>
          {step === "about" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                className="bg-foreground text-background hover:bg-foreground"
                onClick={() => setStep("theme")}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => setStep("about")}>
                Back
              </Button>
              <Button
                className="bg-foreground text-background hover:bg-foreground"
                disabled={busy || !themeId}
                onClick={() => void submit()}
              >
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
