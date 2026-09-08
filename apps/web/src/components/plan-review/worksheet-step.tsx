import { GENERATABLE_BLOCK_TYPES } from "@tj/domain/documents";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EditableListRow,
  Label,
  QuestionShell,
  Switch,
} from "@tj/ui";
import { ChevronDown } from "lucide-react";
import { type Dispatch, useId, useRef } from "react";
import {
  BLOCK_TYPE_LABELS,
  BLOCKS_MAX,
  type PlanReviewAction,
  type PlanReviewState,
  TIER_LABELS,
  TIERS,
} from "@/lib/plan-review";
import { AddRowButton, arrive, markOf, useArrivalFocus } from "./shared";

export function WorksheetStep({
  state,
  dispatch,
}: {
  state: PlanReviewState;
  dispatch: Dispatch<PlanReviewAction>;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useArrivalFocus(first);
  const id = useId();
  const { worksheet } = state;
  return (
    <QuestionShell
      eyebrow="4 of 5"
      question="Do you want a worksheet to go with it?"
      help="The worksheet is what they take away. Choose the blocks and which tiers to write."
    >
      <div className="flex items-center gap-3">
        <Switch
          id={`${id}-enabled`}
          ref={first}
          checked={worksheet.enabled}
          onCheckedChange={(enabled) => dispatch({ type: "setWorksheetEnabled", enabled })}
        />
        <Label htmlFor={`${id}-enabled`} className="text-body">
          {worksheet.enabled ? "Yes, write a worksheet" : "No worksheet this time"}
        </Label>
        <span
          className={cn(
            "text-eyebrow font-semibold uppercase tracking-wide",
            markOf(state, "worksheet:enabled") === "yours" ? "text-brand-text" : "text-ink-3",
          )}
        >
          {markOf(state, "worksheet:enabled")}
        </span>
      </div>
      {worksheet.enabled ? (
        <>
          <ol className="flex flex-col gap-2" aria-label="Worksheet blocks">
            {worksheet.blocks.map((block, i) => (
              <EditableListRow
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no ids in the outline
                key={i}
                mark={markOf(state, "worksheet:blocks")}
                leading={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Block ${i + 1} type: ${BLOCK_TYPE_LABELS[block.type]}`}
                        className="w-32 justify-between"
                      >
                        <span className="truncate">{BLOCK_TYPE_LABELS[block.type]}</span>
                        <ChevronDown aria-hidden size={14} strokeWidth={1.5} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {GENERATABLE_BLOCK_TYPES.map((type) => (
                        <DropdownMenuItem
                          key={type}
                          onSelect={() => dispatch({ type: "editBlock", index: i, type_: type })}
                        >
                          {BLOCK_TYPE_LABELS[type]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
                field={{
                  value: block.summary,
                  onChange: (summary) => dispatch({ type: "editBlock", index: i, summary }),
                  label: `Block ${i + 1} summary`,
                  placeholder: "What this block asks",
                }}
                onRemove={() => dispatch({ type: "removeBlock", index: i })}
                removeLabel={`Remove block ${i + 1}`}
                {...arrive(i)}
              />
            ))}
          </ol>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <AddRowButton onClick={() => {}} disabled={worksheet.blocks.length >= BLOCKS_MAX}>
                Add a block
              </AddRowButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {GENERATABLE_BLOCK_TYPES.map((type) => (
                <DropdownMenuItem
                  key={type}
                  onSelect={() => dispatch({ type: "addBlock", blockType: type })}
                >
                  {BLOCK_TYPE_LABELS[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-meta text-ink-2">
              Tiers to write
              <span className="ml-2 text-eyebrow font-semibold uppercase tracking-wide text-ink-3">
                {markOf(state, "worksheet:tiers")}
              </span>
            </legend>
            {TIERS.map((tier) => {
              const on = worksheet.tiers.includes(tier);
              return (
                <button
                  key={tier}
                  type="button"
                  aria-pressed={on}
                  onClick={() => dispatch({ type: "toggleTier", tier })}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3 text-body font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
                    on
                      ? "border-brand-tint-line bg-brand-tint text-brand-text"
                      : "border-border bg-card text-ink-3 hover:bg-accent hover:text-foreground",
                  )}
                >
                  {TIER_LABELS[tier]}
                </button>
              );
            })}
          </fieldset>
        </>
      ) : null}
    </QuestionShell>
  );
}
