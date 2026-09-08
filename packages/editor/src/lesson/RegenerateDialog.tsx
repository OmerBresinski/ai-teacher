import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@tj/ui";
import { useId, useState } from "react";
import { findElement } from "../model/reducers";
import { useLesson } from "./document-context";
import { impactPreview, impactSentence } from "./impact-preview";
import { useProposals } from "./proposals-context";
import { useSessionActions, useSessionUi } from "./use-editor-session";

/*
 * The Regenerate dialog (TEACH-134, ADR 0025 §18): one slide or element, an optional instruction
 * (≤ `INSTRUCTION_MAX` characters) and the informational "Also changes" line from `impactPreview`.
 * A teacher-authored target is asked about first — regenerating it hands it back to the AI. On
 * confirm the app's `onRegenerate` enqueues `lesson.regenerate`; the dialog closes and the target
 * slide shows the busy overlay until the proposal lands. Opened from the slide toolbar, the More
 * drawer and the navigator's menu through the session's `regenerate` state.
 */

export const INSTRUCTION_MAX = 500;

export function RegenerateDialog() {
  const lesson = useLesson();
  const { regenerate: target } = useSessionUi();
  const { closeRegenerate } = useSessionActions();
  const { onRegenerate } = useProposals();
  const [instruction, setInstruction] = useState("");
  const [confirmedReplace, setConfirmedReplace] = useState(false);
  const instructionId = useId();

  const close = () => {
    setInstruction("");
    setConfirmedReplace(false);
    closeRegenerate();
  };
  if (!target) return null;

  const slideIndex = lesson.slides.findIndex((s) => s.id === target.slideId);
  const slide = lesson.slides[slideIndex];
  const element =
    slide && target.elementId !== undefined ? findElement(slide, target.elementId) : undefined;
  const what = element ? "element" : `slide ${slideIndex + 1}`;
  const teacherAuthored = element
    ? element.authoredBy === "teacher"
    : (slide?.elements.some((e) => e.authoredBy === "teacher") ?? false);
  const askFirst = teacherAuthored && !confirmedReplace;
  const preview = impactSentence(impactPreview(lesson, target));

  const confirm = () => {
    onRegenerate?.(target, instruction.trim() === "" ? undefined : instruction.trim());
    close();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent size="sm" data-regenerate-dialog>
        <DialogHeader>
          <DialogTitle>{askFirst ? "Replace your edits?" : `Regenerate ${what}`}</DialogTitle>
          <DialogDescription>
            {askFirst
              ? `This ${what} has your edits. Regenerating replaces them with new AI-written content.`
              : `The AI rewrites this ${what} from the lesson's facts. ${preview}.`}
          </DialogDescription>
        </DialogHeader>
        {askFirst ? null : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={instructionId} className="font-medium text-meta">
              Instruction (optional)
            </label>
            <Textarea
              id={instructionId}
              rows={3}
              maxLength={INSTRUCTION_MAX}
              value={instruction}
              placeholder="e.g. Use a football example"
              onChange={(e) => setInstruction(e.target.value)}
            />
            <span className="self-end text-ink-3 text-meta" aria-live="polite">
              {instruction.length}/{INSTRUCTION_MAX}
            </span>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {askFirst ? (
            <Button variant="primary" onClick={() => setConfirmedReplace(true)}>
              Yes, replace them
            </Button>
          ) : (
            <Button variant="primary" onClick={confirm} disabled={!onRegenerate}>
              Regenerate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
