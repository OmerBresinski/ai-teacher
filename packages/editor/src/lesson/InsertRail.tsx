import type { SlideElement, SlideKind } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Tooltip,
} from "@tj/ui";
import {
  CircleHelp,
  CircleQuestionMark,
  Image as ImageIcon,
  Minus,
  Square,
  Table as TableIcon,
  Timer as TimerIcon,
  Type,
  Video,
} from "lucide-react";
import { memo } from "react";
import { Rail, RailButton, RailSeparator } from "../kit/Rail";
import {
  LINE_KINDS,
  makeEmbed,
  makeLine,
  makeShape,
  makeTable,
  makeText,
  makeTimer,
  SHAPE_KINDS,
  TEXT_PRESETS,
} from "../model/insert";
import { SLIDE_KIND_LABELS } from "../model/layouts";
import { getTheme } from "../model/themes";
import { useHistory, useLesson } from "./document-context";
import { IconPicker } from "./insert/IconPicker";
import { LessonInfo } from "./insert/LessonInfo";
import { hint } from "./keys";
import { addSlideAfter } from "./slide-commands";
import { useActiveSlide, useSessionActions } from "./use-editor-session";

/** The question kinds insert a whole slide, not an element (SPEC §7). */
const QUESTION_KINDS: SlideKind[] = [
  "true-false",
  "multiple-choice",
  "matching",
  "image-match",
  "fill-gap",
  "sort",
  "open-response",
];

const ICON = { size: 20, strokeWidth: 1.5 } as const;

export type InsertRailProps = {
  /** Add an element to the active slide and select it; `edit` opens the text editor on it. */
  onInsert: (el: SlideElement, options?: { edit?: boolean }) => void;
  onHelp: () => void;
};

/**
 * The insert rail (TeachDeck `components/v2/editor/InsertRail.tsx`): text presets, image, shapes,
 * lines, icons, table, question slides, timer, embed, then Info and Help at the foot. The image
 * button is off until the images ticket (TEACH-107).
 */
export const InsertRail = memo(function InsertRail({ onInsert, onHelp }: InsertRailProps) {
  const lesson = useLesson();
  const theme = getTheme(lesson.themeId);
  const history = useHistory();
  const session = useSessionActions();
  // Resolved, not the raw session id: before the teacher picks a slide it is `null`, and a new
  // question slide must still land after the one on the canvas rather than at the end.
  const activeSlideId = useActiveSlide(lesson.slides)?.id ?? null;

  return (
    <Rail aria-label="Insert">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <RailButton label="Text" shortcut={hint("t")}>
            <Type aria-hidden {...ICON} />
          </RailButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" aria-label="Text">
          {TEXT_PRESETS.map((p) => (
            <DropdownMenuItem
              key={p.preset}
              onSelect={() => onInsert(makeText(p.preset, theme), { edit: true })}
            >
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <RailButton
        label="Image"
        shortcut={hint("i")}
        tooltipLabel="Images arrive with a later release"
        aria-disabled="true"
        className="cursor-default opacity-50 hover:bg-transparent hover:text-ink-2"
      >
        <ImageIcon aria-hidden {...ICON} />
      </RailButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <RailButton label="Shape" shortcut={hint("r")}>
            <Square aria-hidden {...ICON} />
          </RailButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" aria-label="Shape">
          {SHAPE_KINDS.map((s) => (
            <DropdownMenuItem key={s.shape} onSelect={() => onInsert(makeShape(s.shape, theme))}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <RailButton label="Line" shortcut={hint("l")}>
            <Minus aria-hidden {...ICON} />
          </RailButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" aria-label="Line">
          {LINE_KINDS.map((l) => (
            <DropdownMenuItem key={l.id} onSelect={() => onInsert(makeLine(l.id, theme))}>
              {l.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <IconPicker theme={theme} onInsert={onInsert} />

      <RailButton label="Table" onClick={() => onInsert(makeTable(theme))}>
        <TableIcon aria-hidden {...ICON} />
      </RailButton>

      <RailSeparator />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <RailButton label="Question slide">
            <CircleQuestionMark aria-hidden {...ICON} />
          </RailButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" aria-label="Question slide">
          <DropdownMenuLabel>New slide</DropdownMenuLabel>
          {QUESTION_KINDS.map((kind) => (
            <DropdownMenuItem
              key={kind}
              onSelect={() => addSlideAfter({ history, lesson, session }, activeSlideId, kind)}
            >
              {SLIDE_KIND_LABELS[kind]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <RailButton label="Timer" onClick={() => onInsert(makeTimer())}>
        <TimerIcon aria-hidden {...ICON} />
      </RailButton>
      <RailButton label="Embed" onClick={() => onInsert(makeEmbed())}>
        <Video aria-hidden {...ICON} />
      </RailButton>

      {/* `?` is otherwise the only way to reach the shortcuts sheet — every action needs a
          visible control too (SPEC §0 principle 5). */}
      <div className="mt-auto flex flex-col items-center gap-1 pt-1.5">
        <RailSeparator />
        <LessonInfo />
        <Tooltip label="Keyboard shortcuts" shortcut="?" side="right">
          <RailButton label="Keyboard shortcuts" onClick={onHelp}>
            <CircleHelp aria-hidden {...ICON} />
          </RailButton>
        </Tooltip>
      </div>
    </Rail>
  );
});
