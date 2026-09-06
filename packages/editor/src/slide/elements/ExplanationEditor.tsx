import type { Slide, Theme } from "@tj/domain/documents";
import { useEffect, useRef, useState } from "react";
import {
  EXPLANATION_PLACEHOLDER,
  explanationLayout,
  reservedLines,
} from "../../layout/explanation";
import { useEditSession } from "../../model/use-edit-session";
import { useEditingState, useEditorHooks } from "../editor-hooks";
import { ExplanationPanel } from "./ExplanationPanel";

/**
 * The editor's copy of the "Why?" panel (TeachDeck `ExplanationEditor.tsx`). Loaded only in edit
 * mode, so the viewer, present, capture and thumb bundles carry neither the editing-state
 * subscription nor the typing surface.
 *
 * The reason is a plain string on `slide.question`, not an element with a rich doc, so this cannot
 * use `useInlineEditor`. It keeps that hook's contract all the same: each keystroke is written
 * inside an edit session (one undo step per burst), Escape and blur both leave, and the last
 * keystroke is never lost.
 */
export default function ExplanationEditor({
  slide,
  theme,
  text,
}: {
  slide: Slide;
  theme: Theme;
  text: string;
}) {
  const editing = useEditingState().editingExplanation === slide.id;
  if (!editing) return <ExplanationPanel slide={slide} theme={theme} text={text} mode="edit" />;
  return <Session slide={slide} theme={theme} text={text} />;
}

function Session({ slide, theme, text }: { slide: Slide; theme: Theme; text: string }) {
  const hooks = useEditorHooks();
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const host = useRef<HTMLDivElement>(null);
  // Fixed on entry: the seed text and the panel's own identity must not change under the caret
  // because the cache wrote back what we just typed.
  const [initial] = useState(text);
  // The panel grows as the teacher types, so the geometry follows the draft.
  const [draft, setDraft] = useState(text);
  const slideId = slide.id;

  const session = useEditSession({
    beginTransaction: () => hooksRef.current?.beginTransaction(),
    endTransaction: (token) => hooksRef.current?.endTransaction(token),
  });
  const write = (value: string) =>
    session.run(() => hooksRef.current?.writeExplanation(slideId, value));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const empty = draft.trim().length === 0;
  const layout = explanationLayout({
    slide,
    theme,
    text: empty ? EXPLANATION_PLACEHOLDER : draft,
  });
  // How many lines this slide's lane holds is a rule, not a guess (`reservedLines`). When it is
  // one, say so while the teacher is typing rather than letting them find out from a clipped
  // second line. (The DOM ruler arrives with the layout engine; the estimate is on the safe side.)
  const oneLine = reservedLines(slide, theme) <= 1;
  const textOf = (el: HTMLDivElement) => el.innerText.replace(/\n+$/, "");

  return (
    <ExplanationPanel
      slide={slide}
      theme={theme}
      text={draft}
      mode="edit"
      box={layout}
      editorSlot={
        // A textarea cannot take the panel's own type and grow with it inside the slide's
        // coordinate space; this is TeachDeck's editable div, made focusable and named.
        // biome-ignore lint/a11y/useSemanticElements: see above
        <div
          ref={host}
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          role="textbox"
          aria-multiline="true"
          aria-label="Why this is the answer"
          data-explanation-editor=""
          onInput={(e) => {
            const value = textOf(e.currentTarget);
            setDraft(value);
            write(value);
          }}
          onBlur={(e) => {
            write(textOf(e.currentTarget));
            session.end();
            hooksRef.current?.exitExplanationEdit();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            session.end();
            hooksRef.current?.exitExplanationEdit();
          }}
          onPaste={(e) => {
            // Plain text only: the panel is one voice on the slide, not a place to smuggle in
            // another document's formatting.
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
          style={{
            margin: 0,
            outline: "none",
            fontFamily: theme.fonts.body,
            fontSize: layout.bodySize,
            lineHeight: theme.lineHeights.body,
            fontWeight: theme.weights.body,
            color: theme.colors.ink,
            whiteSpace: "pre-wrap",
            caretColor: theme.colors.accent,
          }}
        >
          {initial}
        </div>
      }
      hint={oneLine ? "Room for one line on this slide" : undefined}
    />
  );
}
