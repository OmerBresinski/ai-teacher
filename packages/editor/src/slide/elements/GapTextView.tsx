import type { GapTextElement, Theme } from "@tj/domain/documents";
import { useMemo } from "react";
import { renderDocHTML } from "../../text/static";
import {
  type ElementViewProps,
  GAP_TOKEN,
  gapAnswers,
  type LabelParts,
  resolveTextStyle,
  textTypeCss,
  withAlpha,
} from "./kit";
import { RichText } from "./RichText";
import { TextShell } from "./TextView";

/**
 * Edit mode only: the store subscription, the height measurement and, behind another
 * lazy boundary, Tiptap. The viewer, present, capture and thumb bundles carry none of it.
 */
// phase C (TEACH-104): `const EditableLabel = lazy(() => import('./EditableLabel'))` returns here.

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/**
 * `[[gap:ID]]` tokens become a blank underline sized to the answer word — the answer is
 * always in the DOM but hidden, so the line length is exactly right and filling it in on
 * reveal never reflows the sentence.
 *
 * While the teacher is typing into it the tokens are shown as themselves: a blank is not
 * editable text, and hiding the token is how you end up deleting half of one by accident.
 * A hint says so, and it goes away with the editor.
 */
export function GapTextView({
  element,
  theme,
  mode,
  revealAnswer,
  question,
}: ElementViewProps<GapTextElement>) {
  const answers = useMemo(() => gapAnswers(question), [question]);
  const r = resolveTextStyle(element.style, theme);

  const html = useMemo(() => {
    const base = renderDocHTML(element.doc);
    return base.replace(GAP_TOKEN, (_m, id: string) => {
      const answer = answers.get(id) ?? "";
      const word = escapeHtml(answer) || "&nbsp;&nbsp;&nbsp;";
      return `<span class="td-gap" data-gap-id="${escapeHtml(id)}" data-revealed="${revealAnswer}"><span class="td-gap-word">${word}</span></span>`;
    });
  }, [element.doc, answers, revealAnswer]);

  const box = ({ editor, bodyRef, overflowing }: LabelParts) => (
    <TextShell r={r} mode={mode} overflowing={overflowing} theme={theme}>
      {editor ?? (
        <div ref={bodyRef} style={{ width: "100%", flex: "0 0 auto" }}>
          <RichText html={html} style={textTypeCss(r)} />
        </div>
      )}
      {editor ? <GapHint theme={theme} /> : null}
    </TextShell>
  );

  // phase C (TEACH-104): in `edit` mode render `EditableLabel` with `measure` and `render={box}`.
  return box({ editor: null, overflowing: false });
}

/** Says why the sentence suddenly reads `[[gap:a]]`. Never printed, never presented. */
function GapHint({ theme }: { theme: Theme }) {
  return (
    <span
      style={{
        position: "absolute",
        right: 4,
        bottom: 4,
        padding: "2px 7px",
        borderRadius: 6,
        background: withAlpha(theme.colors.ink, 0.08),
        color: theme.colors.muted,
        fontFamily: theme.fonts.body,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: 0,
        textTransform: "none",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      Blanks show as [[gap:id]] while you type
    </span>
  );
}
