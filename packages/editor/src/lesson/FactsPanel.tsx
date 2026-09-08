import type { FactId } from "@tj/domain/documents";
import { Button, cn, IconButton, Input, Spinner, Textarea } from "@tj/ui";
import { Plus, X } from "lucide-react";
import { type ReactNode, useCallback, useRef } from "react";
import * as reducers from "../model/reducers";
import type { FactKind, FactPatch, FactValues } from "../model/reducers/facts";
import { useEditSession } from "../model/use-edit-session";
import { useHistory, useLesson } from "./document-context";
import { useProposals } from "./proposals-context";
import { PanelSection } from "./toolbar/shared";
import { useCoalescedIds } from "./use-coalesced-ids";

/*
 * The facts panel (TEACH-134, ADR 0025 §1, §18, §25): the teacher edits objectives, vocabulary,
 * worked examples and questions in place. Every keystroke is a reducer over the Query cache
 * inside one edit session per typing burst (one undo step, like a typed slide edit); a commit
 * (blur or Enter) whose value differs from the value at focus reports the fact id, and ids
 * reported within a second are one `onFactsChanged` — the app enqueues one cascade for them.
 * Shell chrome, so it dispatches through `useHistory()` directly rather than the renderer hooks.
 */

export const FACTS_PANEL_LABEL = "Facts";

const NEW_FACT: Record<FactKind, FactValues> = {
  objective: { kind: "objective", text: "New objective" },
  vocabulary: { kind: "vocabulary", term: "New term", definition: "" },
  workedExample: { kind: "workedExample", problem: "New problem", steps: [], answer: "" },
  question: { kind: "question", stem: "New question", answer: "", reasoning: "" },
};

export function FactsPanel({ onClose }: { onClose: () => void }) {
  const lesson = useLesson();
  const history = useHistory();
  const { onFactsChanged, busy, reservedFactIds } = useProposals();
  const session = useEditSession(history);
  const report = useCoalescedIds((ids) => onFactsChanged?.(ids));
  const facts = lesson.facts;

  const write = useCallback(
    (factId: FactId, patch: FactPatch) =>
      session.run(() => history.dispatch(reducers.updateFact, factId, patch)),
    [history, session],
  );
  const commit = useCallback(
    (factId: FactId, changed: boolean) => {
      session.end();
      if (changed) report(factId);
    },
    [session, report],
  );
  // Adding waits for the worksheet's refs (`reservedFactIds === null`): a fresh id must not
  // collide with one a worksheet block still derives from.
  const canAdd = reservedFactIds !== null;
  const add = (kind: FactKind) => {
    if (!canAdd) return;
    const made = history.dispatch(reducers.addFact, NEW_FACT[kind], reservedFactIds);
    if (made?.id) report(made.id);
  };
  const remove = (factId: FactId) => {
    history.dispatch(reducers.removeFact, factId);
    report(factId);
  };

  return (
    <aside
      aria-label={FACTS_PANEL_LABEL}
      data-facts-panel
      className="flex w-(--facts-panel-width,320px) shrink-0 flex-col border-border border-l bg-card"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-3">
        <h2 className="m-0 font-semibold text-body">{FACTS_PANEL_LABEL}</h2>
        {busy ? (
          <span className="flex items-center gap-1.5 text-ink-3 text-meta" data-facts-busy>
            <Spinner size={16} />
            Updating slides…
          </span>
        ) : null}
        <IconButton label="Close facts" size="sm" className="ml-auto" onClick={onClose}>
          <X aria-hidden size={16} strokeWidth={1.5} />
        </IconButton>
      </header>
      {facts ? (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <Section
            title="Objectives"
            canAdd={canAdd}
            onAdd={() => add("objective")}
            addLabel="Add objective"
          >
            {facts.objectives.map((o, i) => (
              <Row
                key={o.id}
                onRemove={() => remove(o.id)}
                removeLabel={`Remove objective ${i + 1}`}
              >
                <FactField
                  label={`Objective ${i + 1}`}
                  value={o.text}
                  onChange={(text) => write(o.id, { text })}
                  onCommit={(changed) => commit(o.id, changed)}
                />
                {o.curriculumRef?.status === "inferred" ? (
                  <span className="text-ink-3 text-meta">Curriculum: inferred</span>
                ) : null}
              </Row>
            ))}
          </Section>
          <Section
            title="Vocabulary"
            canAdd={canAdd}
            onAdd={() => add("vocabulary")}
            addLabel="Add term"
          >
            {facts.vocabulary.map((v, i) => (
              <Row key={v.id} onRemove={() => remove(v.id)} removeLabel={`Remove term ${i + 1}`}>
                <FactField
                  label={`Term ${i + 1}`}
                  value={v.term}
                  onChange={(term) => write(v.id, { term })}
                  onCommit={(changed) => commit(v.id, changed)}
                />
                <FactField
                  label={`Definition ${i + 1}`}
                  value={v.definition}
                  multiline
                  onChange={(definition) => write(v.id, { definition })}
                  onCommit={(changed) => commit(v.id, changed)}
                />
              </Row>
            ))}
          </Section>
          <Section
            title="Worked examples"
            canAdd={canAdd}
            onAdd={() => add("workedExample")}
            addLabel="Add worked example"
          >
            {facts.workedExamples.map((x, i) => (
              <Row
                key={x.id}
                onRemove={() => remove(x.id)}
                removeLabel={`Remove worked example ${i + 1}`}
              >
                <FactField
                  label={`Problem ${i + 1}`}
                  value={x.problem}
                  multiline
                  onChange={(problem) => write(x.id, { problem })}
                  onCommit={(changed) => commit(x.id, changed)}
                />
                <FactField
                  label={`Steps ${i + 1}`}
                  value={x.steps.join("\n")}
                  multiline
                  onChange={(text) => write(x.id, { steps: splitLines(text) })}
                  onCommit={(changed) => commit(x.id, changed)}
                />
                <FactField
                  label={`Answer ${i + 1}`}
                  value={x.answer}
                  onChange={(answer) => write(x.id, { answer })}
                  onCommit={(changed) => commit(x.id, changed)}
                />
              </Row>
            ))}
          </Section>
          <Section
            title="Questions"
            canAdd={canAdd}
            onAdd={() => add("question")}
            addLabel="Add question"
          >
            {facts.questions.map((q, i) => (
              <Row
                key={q.id}
                onRemove={() => remove(q.id)}
                removeLabel={`Remove question ${i + 1}`}
              >
                <FactField
                  label={`Question ${i + 1}`}
                  value={q.stem}
                  multiline
                  onChange={(stem) => write(q.id, { stem })}
                  onCommit={(changed) => commit(q.id, changed)}
                />
                <FactField
                  label={`Question ${i + 1} answer`}
                  value={q.answer}
                  onChange={(answer) => write(q.id, { answer })}
                  onCommit={(changed) => commit(q.id, changed)}
                />
                <FactField
                  label={`Question ${i + 1} reasoning`}
                  value={q.reasoning}
                  multiline
                  onChange={(reasoning) => write(q.id, { reasoning })}
                  onCommit={(changed) => commit(q.id, changed)}
                />
              </Row>
            ))}
          </Section>
        </div>
      ) : (
        <p className="p-3 text-ink-3 text-meta">
          This lesson was not generated from a brief, so it has no facts to edit.
        </p>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */

const splitLines = (text: string) => text.split("\n").filter((line) => line.trim().length > 0);

function Section({
  title,
  addLabel,
  canAdd,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  canAdd: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <PanelSection title={title}>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">{children}</ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd ? undefined : "Loading the worksheet…"}
      >
        <Plus aria-hidden size={14} strokeWidth={1.5} />
        {addLabel}
      </Button>
    </PanelSection>
  );
}

function Row({
  children,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <li className="flex items-start gap-1">
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      <IconButton label={removeLabel} size="sm" onClick={onRemove}>
        <X aria-hidden size={14} strokeWidth={1.5} />
      </IconButton>
    </li>
  );
}

/**
 * One fact field. Controlled by the document; remembers the value it had on focus so a commit
 * that changed nothing (a click in and out) reports no fact.
 */
function FactField({
  label,
  value,
  multiline = false,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onCommit: (changed: boolean) => void;
}) {
  const atFocus = useRef(value);
  const props = {
    "aria-label": label,
    value,
    onFocus: () => {
      atFocus.current = value;
    },
    onBlur: () => onCommit(value !== atFocus.current),
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    // Enter commits a one-line field; a textarea keeps Enter for a new line and commits on ⌘/Ctrl+Enter.
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter") return;
      if (multiline && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      (e.target as HTMLElement).blur();
    },
    className: cn("text-body", multiline ? "min-h-14" : "h-8"),
  };
  return multiline ? <Textarea rows={2} {...props} /> : <Input {...props} />;
}
