import type { Lesson } from "@tj/domain/documents";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tj/ui";
import { useId } from "react";
import type * as reducers from "../../model/reducers";
import type { useEditSession } from "../../model/use-edit-session";
import { DEFAULT_LANGUAGE, LANGUAGES, NOT_SET, YEAR_GROUPS } from "./lesson-info-options";

/**
 * The Info popover's edit fields. They load only when a teacher opens the popover (the Radix
 * Select they use is off the editor's first paint, TEACH-113's route budget).
 */
export function LessonInfoFields({
  lesson,
  typing,
  setMeta,
  setYearGroup,
}: {
  lesson: Lesson;
  typing: ReturnType<typeof useEditSession>;
  setMeta: (patch: reducers.LessonMetaPatch) => void;
  /** Sets the year group and the key stage derived from it (`undefined` clears both). */
  setYearGroup: (yearGroup: string | undefined) => void;
}) {
  const subjectId = useId();
  const yearId = useId();
  const readingId = useId();
  const languageId = useId();

  return (
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
          onValueChange={(v) => setYearGroup(v === NOT_SET ? undefined : v)}
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
