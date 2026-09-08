import type { Lesson } from "@tj/domain/documents";
import { cn, QuestionShell } from "@tj/ui";
import type { ReactNode } from "react";
import {
  BLOCK_TYPE_LABELS,
  isYours,
  type PlanReviewState,
  SLIDE_KIND_LABELS,
  TIER_LABELS,
  totalMinutes,
  yoursKeys,
} from "@/lib/plan-review";
import { arrive } from "./shared";

function Yours({ show }: { show: boolean }) {
  return show ? (
    <span className="ml-2 text-eyebrow font-semibold uppercase tracking-wide text-brand-text">
      yours
    </span>
  ) : null;
}

function Section({
  title,
  yours,
  children,
  index,
}: {
  title: string;
  yours: boolean;
  children: ReactNode;
  index: number;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-card border border-border bg-card p-4 shadow-1",
        arrive(index).className,
      )}
      style={arrive(index).style}
    >
      <h3 className="mb-2 text-meta font-semibold text-ink-2">
        {title}
        <Yours show={yours} />
      </h3>
      {children}
    </section>
  );
}

const list = (items: string[]) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function SummaryStep({ state, lesson }: { state: PlanReviewState; lesson: Lesson }) {
  const edits = yoursKeys(state).length;
  const total = totalMinutes(state);
  const who = lesson.yearGroup ? ` for ${lesson.yearGroup}` : "";
  const shapeYours =
    isYours(state, "phases:order") ||
    isYours(state, "phases:list") ||
    state.phases.some((phase) => isYours(state, `phase:${phase.id}`));
  const objectivesYours =
    isYours(state, "objectives:list") ||
    isYours(state, "objectives:order") ||
    state.objectives.some((o) => isYours(state, `objective:${o.id}`));
  const wordsYours =
    isYours(state, "vocabulary:list") ||
    state.vocabulary.some((v) => isYours(state, `vocabulary:${v.id}`));
  const worksheetYours =
    isYours(state, "worksheet:enabled") ||
    isYours(state, "worksheet:blocks") ||
    isYours(state, "worksheet:tiers");
  return (
    <QuestionShell
      eyebrow="5 of 5"
      question="Here is the plan. Ready to write the slides?"
      help={
        edits === 0
          ? `A ${total}-minute lesson on ${lesson.title}${who}, as suggested.`
          : `A ${total}-minute lesson on ${lesson.title}${who}. ${edits === 1 ? "One change is" : `${edits} changes are`} yours; the rest is as suggested.`
      }
    >
      <div className="flex flex-col gap-3">
        <Section title="Objectives" yours={objectivesYours} index={0}>
          <ol className="list-decimal space-y-1 pl-5 text-body">
            {state.objectives.map((o) => (
              <li key={o.id}>
                {o.text || <span className="text-ink-3">(empty)</span>}
                <Yours show={isYours(state, `objective:${o.id}`)} />
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Shape of the lesson" yours={shapeYours} index={1}>
          <p className="mb-2 text-body text-ink-2">
            {state.phases.length} slides over {total} minutes
            {total !== state.base.durationMin ? ` (the brief said ${state.base.durationMin})` : ""}.
          </p>
          <ol className="space-y-1 text-body">
            {state.phases.map((phase, i) => (
              <li key={phase.id} className="flex gap-3">
                <span className="w-5 shrink-0 text-right text-ink-3 tabular-nums">{i + 1}</span>
                <span className="w-24 shrink-0 font-medium">{SLIDE_KIND_LABELS[phase.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{phase.summary}</span>
                <span className="shrink-0 text-ink-3 tabular-nums">{phase.minutes} min</span>
                <Yours show={isYours(state, `phase:${phase.id}`)} />
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Words they will need" yours={wordsYours} index={2}>
          <p className="text-body">
            {state.vocabulary.length === 0
              ? "No key words."
              : list(state.vocabulary.map((v) => v.term || "(empty)"))}
          </p>
        </Section>
        <Section title="Worksheet" yours={worksheetYours} index={3}>
          <p className="text-body">
            {state.worksheet.enabled
              ? `${state.worksheet.blocks.length} blocks (${list([
                  ...new Set(
                    state.worksheet.blocks.map((b) => BLOCK_TYPE_LABELS[b.type].toLowerCase()),
                  ),
                ])})${
                  state.worksheet.tiers.length > 0
                    ? ` at ${list(state.worksheet.tiers.map((t) => TIER_LABELS[t].toLowerCase()))} ${state.worksheet.tiers.length === 1 ? "tier" : "tiers"}`
                    : ", one tier"
                }.`
              : "No worksheet."}
          </p>
        </Section>
      </div>
    </QuestionShell>
  );
}
