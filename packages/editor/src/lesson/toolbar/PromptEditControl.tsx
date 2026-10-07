import type { TextElement } from "@tj/domain/documents";
import {
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  toast,
} from "@tj/ui";
import { Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import * as reducers from "../../model/reducers";
import { useHistory, useLesson } from "../document-context";
import { type PromptEditAnswer, useProposals } from "../proposals-context";
import { useSessionActions, useSessionUi } from "../use-editor-session";

/*
 * Edit with a prompt, fast path (TEACH-97 part d). A button on the text toolbar opens a small
 * panel: the one-tap suggestions that are text edits (ruling 175: Easier, Harder, Shorter, Turn
 * into a question; Add a picture and Animate come with the agent path) and a free instruction.
 * The edit applies at once as one undo step, and a toast names it with Undo; undoing confirms
 * "Undid: …" (ruling 172). A refusal shows its reason in the panel and changes nothing. The
 * editor never speaks HTTP: the app's `onPromptEdit` does (`proposals-context.ts`).
 */

export const PROMPT_EDIT_LABEL = "Edit with a prompt";

/** The text-edit suggestions of ruling 175, with the instruction each sends. */
export const SUGGESTIONS = [
  { label: "Easier", instruction: "Make it easier" },
  { label: "Harder", instruction: "Make it harder" },
  { label: "Shorter", instruction: "Make it shorter" },
  { label: "Turn into a question", instruction: "Turn it into a question" },
] as const;

const ICON = { size: 20, strokeWidth: 1.5 } as const;

/** The panel's message for an answer that changed nothing. */
export function refusalOf(answer: PromptEditAnswer): string | null {
  return answer.action === "edit" ? null : answer.reason;
}

export function PromptEditControl({ element, slideId }: { element: TextElement; slideId: string }) {
  const { onPromptEdit } = useProposals();
  const lesson = useLesson();
  const history = useHistory();
  const { editingTextId } = useSessionUi();
  const actions = useSessionActions();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);

  if (!onPromptEdit) return null;

  const run = async (text: string) => {
    const said = text.trim();
    const slide = lesson.slides.find((s) => s.id === slideId);
    if (said === "" || !slide || busy) return;
    setBusy(said);
    setMessage(null);
    let answer: PromptEditAnswer;
    try {
      answer = await onPromptEdit({ slide, elementId: element.id, instruction: said });
    } catch {
      answer = { action: "failed", reason: "That edit didn’t work. Try again." };
    }
    setBusy(null);
    if (answer.action !== "edit") {
      setMessage(answer.reason);
      return;
    }
    // Leave an open text edit first, so the change is its own undo step (as `applyProposals`).
    if (editingTextId === element.id) actions.setEditingText(null);
    history.flushTransactions();
    history.dispatch(reducers.updateElement, slideId, element.id, {
      doc: answer.doc,
    } as Partial<TextElement>);
    setOpen(false);
    setInstruction("");
    toast(answer.summary || "Edited", {
      action: {
        label: "Undo",
        onClick: () => {
          history.undo();
          toast(`Undid: ${said}`);
        },
      },
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMessage(null);
      }}
    >
      <PopoverTrigger asChild>
        <IconButton label={PROMPT_EDIT_LABEL} active={open}>
          <Sparkles aria-hidden {...ICON} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3"
        aria-label={PROMPT_EDIT_LABEL}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          field.current?.focus();
        }}
      >
        <form
          className="flex flex-col gap-2.5"
          data-prompt-edit
          onSubmit={(e) => {
            e.preventDefault();
            void run(instruction);
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s.label}
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => void run(s.instruction)}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              ref={field}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Or say what to change"
              aria-label="What to change"
              maxLength={500}
              disabled={busy !== null}
              autoComplete="off"
              className="h-8"
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy !== null}>
              Edit
            </Button>
          </div>
          {busy !== null ? (
            <p className="m-0 flex items-center gap-1.5 text-ink-3 text-meta" aria-live="polite">
              <Spinner size={16} />
              Editing…
            </p>
          ) : message ? (
            <p role="alert" className="m-0 text-foreground text-meta">
              {message}
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
