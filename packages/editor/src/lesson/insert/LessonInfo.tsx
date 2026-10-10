import { deriveAgeBand } from "@tj/domain/documents";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@tj/ui";
import { Info } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { RailButton } from "../../kit/Rail";
import * as reducers from "../../model/reducers";
import { useEditSession } from "../../model/use-edit-session";
import { useHistory, useLesson } from "../document-context";
import { languageLabel } from "./lesson-info-options";

// The edit fields (and the Radix Select they use) load when the popover first opens.
const loadFields = () => import("./LessonInfoFields");
const LessonInfoFields = lazy(() => loadFields().then((m) => ({ default: m.LessonInfoFields })));

export { YEAR_GROUPS } from "./lesson-info-options";

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

  const setMeta = (patch: reducers.LessonMetaPatch) =>
    history.dispatch(reducers.setLessonMeta, patch);
  const setYearGroup = (yearGroup: string | undefined) =>
    setMeta(
      yearGroup === undefined
        ? { yearGroup: undefined, ageBand: undefined }
        : { yearGroup, ageBand: deriveAgeBand(yearGroup) },
    );

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
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setEditing(false);
          void loadFields();
        } else typing.end();
      }}
    >
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
            <Suspense fallback={null}>
              <LessonInfoFields
                lesson={lesson}
                typing={typing}
                setMeta={setMeta}
                setYearGroup={setYearGroup}
              />
            </Suspense>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
