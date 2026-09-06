import { deriveAgeBand } from "@tj/domain/documents";
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tj/ui";
import { Info } from "lucide-react";
import { useId, useState } from "react";
import { RailButton } from "../../kit/Rail";
import * as reducers from "../../model/reducers";
import { useEditSession } from "../../model/use-edit-session";
import { useHistory, useLesson } from "../document-context";

/** Teachers pick a year group; the key stage (`ageBand`) is derived from it. */
export const YEAR_GROUPS = [
  "EYFS",
  ...Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`),
] as const;

/** Languages a UK school sets work in, matching the New lesson dialog. */
const LANGUAGES: { value: string; label: string }[] = [
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "cy", label: "Welsh" },
];
const DEFAULT_LANGUAGE = "en-GB";
const NOT_SET = "__none";

const languageLabel = (value: string | undefined) =>
  LANGUAGES.find((l) => l.value === (value ?? DEFAULT_LANGUAGE))?.label ?? value ?? "";

/** "3 Sept 2026" in the lesson's own language, or nothing if the stored date cannot be read. */
export function createdLabel(iso: string | undefined, language: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const locale = language === "en-US" ? "en-US" : "en-GB";
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The rail's "Info" item (Chalkie's `21-lesson-info.png`): what this lesson is, and the fields the
 * New lesson dialog asks for and nothing else edits afterwards.
 */
export function LessonInfo() {
  const lesson = useLesson();
  const history = useHistory();
  const typing = useEditSession(history);
  const [editing, setEditing] = useState(false);
  const subjectId = useId();
  const yearId = useId();
  const readingId = useId();
  const languageId = useId();

  const setMeta = (patch: reducers.LessonMetaPatch) =>
    history.dispatch(reducers.setLessonMeta, patch);

  const created = createdLabel(lesson.createdAt, lesson.language);
  const slides = lesson.slides.length;
  const meta = [
    languageLabel(lesson.language),
    lesson.subject,
    lesson.yearGroup,
    lesson.readingLevel ? `Reading level: ${lesson.readingLevel}` : null,
    `${slides} ${slides === 1 ? "slide" : "slides"}`,
  ].filter(Boolean);

  return (
    <Popover onOpenChange={(open) => (open ? setEditing(false) : typing.end())}>
      <PopoverTrigger asChild>
        <RailButton label="Info">
          <Info aria-hidden size={20} strokeWidth={1.5} />
        </RailButton>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="w-[300px] p-3"
        aria-label="Lesson information"
      >
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 font-semibold text-body text-foreground">Lesson information</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing((e) => !e)}
              className="h-6 px-1.5"
            >
              {editing ? "Done" : "Edit"}
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <p className="m-0 text-body text-foreground">{lesson.title || "Untitled lesson"}</p>
            {created ? <p className="m-0 text-ink-3 text-meta">Created {created}</p> : null}
            <p className="m-0 text-ink-3 text-meta">{meta.join(" • ")}</p>
          </div>

          {editing ? (
            <div className="flex flex-col gap-2">
              <Row label="Subject" htmlFor={subjectId}>
                <Input
                  id={subjectId}
                  value={lesson.subject ?? ""}
                  placeholder="Science"
                  onBlur={typing.end}
                  onChange={(e) => typing.run(() => setMeta({ subject: e.target.value }))}
                  className="h-8 w-40"
                />
              </Row>
              <Row label="Year group" htmlFor={yearId}>
                <Select
                  value={lesson.yearGroup ?? NOT_SET}
                  onValueChange={(v) =>
                    setMeta(
                      v === NOT_SET
                        ? { yearGroup: undefined, ageBand: undefined }
                        : { yearGroup: v, ageBand: deriveAgeBand(v) },
                    )
                  }
                >
                  <SelectTrigger id={yearId} className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET}>Not set</SelectItem>
                    {YEAR_GROUPS.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Reading level" htmlFor={readingId}>
                <Select
                  value={lesson.readingLevel ?? NOT_SET}
                  onValueChange={(v) => setMeta({ readingLevel: v === NOT_SET ? undefined : v })}
                >
                  <SelectTrigger id={readingId} className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_SET}>Same as year group</SelectItem>
                    {YEAR_GROUPS.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label="Language" htmlFor={languageId}>
                <Select
                  value={lesson.language ?? DEFAULT_LANGUAGE}
                  onValueChange={(language) => setMeta({ language })}
                >
                  <SelectTrigger id={languageId} className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={htmlFor} className="text-ink-3 text-meta">
        {label}
      </Label>
      {children}
    </div>
  );
}
