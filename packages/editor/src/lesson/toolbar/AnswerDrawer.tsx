import type { QuestionData, Slide } from "@tj/domain/documents";
import {
  Checkbox,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@tj/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId } from "react";
import { PanelRow } from "../../kit/Panel";
import * as reducers from "../../model/reducers";
import { useEditSession } from "../../model/use-edit-session";
import { docToPlainText } from "../../text/static";
import { useHistory } from "../document-context";
import { BarButton, ICON_SM, PanelSection } from "./shared";

function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * Matching is a bijection: giving a term someone else's definition has to hand that pair the
 * definition it just lost, or the drawer can silently create a question with two right-hand cards
 * used twice and one never used.
 */
export function repairPairs(
  pairs: { id: string; leftElementId: string; rightElementId: string }[],
  pairId: string,
  rightElementId: string,
) {
  const target = pairs.find((p) => p.id === pairId);
  if (!target || target.rightElementId === rightElementId) return pairs;
  const displaced = target.rightElementId;
  return pairs.map((p) => {
    if (p.id === pairId) return { ...p, rightElementId };
    if (p.rightElementId === rightElementId) return { ...p, rightElementId: displaced };
    return p;
  });
}

/** The same bijection for image matching. */
export function repairImagePairs(
  pairs: { id: string; imageId: string; labelId: string }[],
  pairId: string,
  labelId: string,
) {
  const target = pairs.find((p) => p.id === pairId);
  if (!target || target.labelId === labelId) return pairs;
  const displaced = target.labelId;
  return pairs.map((p) => {
    if (p.id === pairId) return { ...p, labelId };
    if (p.labelId === labelId) return { ...p, labelId: displaced };
    return p;
  });
}

/** The "Answer" popover on a question slide (TeachDeck `AnswerDrawer`): one form per question kind. */
export function AnswerDrawer({ slide, question }: { slide: Slide; question: QuestionData }) {
  const history = useHistory();
  const typing = useEditSession(history);
  const rowId = useId();
  const set = (next: QuestionData) => history.dispatch(reducers.setQuestion, slide.id, next);
  const type = (next: QuestionData) => typing.run(() => set(next));

  const optionText = (id: string) => {
    const el = slide.elements.find((e) => e.id === id);
    const text = el && "doc" in el && el.doc ? docToPlainText(el.doc) : "";
    return text.trim() || "Untitled option";
  };
  /** A picture has no text to name it by, so the layers name is the label. */
  const pictureName = (id: string, i: number) =>
    slide.elements.find((e) => e.id === id)?.name?.trim() || `Picture ${i + 1}`;

  return (
    <Popover onOpenChange={(open) => !open && typing.end()}>
      <PopoverTrigger asChild>
        <BarButton data-answer-drawer>Answer</BarButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" aria-label="Answer">
        <div className="flex flex-col gap-2.5">
          <PanelSection title="Correct answer">
            {question.type === "true-false" ? (
              <PanelRow label="True or false" htmlFor={`${rowId}-tf`}>
                <Select
                  value={question.correct ? "true" : "false"}
                  onValueChange={(v) => set({ ...question, correct: v === "true" })}
                >
                  <SelectTrigger
                    id={`${rowId}-tf`}
                    className="h-8 w-28"
                    aria-label="Correct answer"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              </PanelRow>
            ) : null}

            {question.type === "multiple-choice" ? (
              <>
                {question.options.map((o) => (
                  <PanelRow key={o.id} label={optionText(o.id)} htmlFor={`${rowId}-${o.id}`}>
                    <Checkbox
                      id={`${rowId}-${o.id}`}
                      checked={o.correct}
                      aria-label={`${optionText(o.id)} is correct`}
                      onCheckedChange={(checked) =>
                        set({
                          ...question,
                          options: question.options.map((x) =>
                            x.id === o.id
                              ? { ...x, correct: checked === true }
                              : question.multi
                                ? x
                                : { ...x, correct: false },
                          ),
                        })
                      }
                    />
                  </PanelRow>
                ))}
                <PanelRow label="Several answers" htmlFor={`${rowId}-multi`}>
                  <Switch
                    id={`${rowId}-multi`}
                    checked={!!question.multi}
                    aria-label="Allow several correct answers"
                    // Back to one answer: keep the first correct option only, so a single-answer
                    // question can never carry two ticks.
                    onCheckedChange={(multi) => {
                      if (multi) {
                        set({ ...question, multi });
                        return;
                      }
                      let kept = false;
                      set({
                        ...question,
                        multi: false,
                        options: question.options.map((o) => {
                          if (!o.correct) return o;
                          if (kept) return { ...o, correct: false };
                          kept = true;
                          return o;
                        }),
                      });
                    }}
                  />
                </PanelRow>
              </>
            ) : null}

            {question.type === "fill-gap" ? (
              <div className="flex flex-col gap-1">
                {question.gaps.map((gap, i) => (
                  <PanelRow key={gap.id} label={`Gap ${i + 1}`} htmlFor={`${rowId}-${gap.id}`}>
                    <Input
                      id={`${rowId}-${gap.id}`}
                      value={gap.answer}
                      aria-label={`Answer for gap ${i + 1}`}
                      className="h-8 w-36"
                      onBlur={typing.end}
                      onChange={(e) =>
                        type({
                          ...question,
                          gaps: question.gaps.map((g) =>
                            g.id === gap.id ? { ...g, answer: e.target.value } : g,
                          ),
                        })
                      }
                    />
                  </PanelRow>
                ))}
              </div>
            ) : null}

            {question.type === "matching" ? (
              <div className="flex flex-col gap-1">
                {question.pairs.map((p) => (
                  <PanelRow
                    key={p.id}
                    label={optionText(p.leftElementId)}
                    htmlFor={`${rowId}-${p.id}`}
                  >
                    <Select
                      value={p.rightElementId}
                      onValueChange={(v) =>
                        set({ ...question, pairs: repairPairs(question.pairs, p.id, v) })
                      }
                    >
                      <SelectTrigger
                        id={`${rowId}-${p.id}`}
                        className="h-8 w-36"
                        aria-label={`Match for ${optionText(p.leftElementId)}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {question.pairs.map((other) => (
                          <SelectItem key={other.rightElementId} value={other.rightElementId}>
                            {optionText(other.rightElementId)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </PanelRow>
                ))}
              </div>
            ) : null}

            {question.type === "image-match" ? (
              <div className="flex flex-col gap-1">
                {question.pairs.map((p, i) => (
                  <PanelRow
                    key={p.id}
                    label={pictureName(p.imageId, i)}
                    htmlFor={`${rowId}-${p.id}`}
                  >
                    <Select
                      value={p.labelId}
                      onValueChange={(v) =>
                        set({ ...question, pairs: repairImagePairs(question.pairs, p.id, v) })
                      }
                    >
                      <SelectTrigger
                        id={`${rowId}-${p.id}`}
                        className="h-8 w-36"
                        aria-label={`Word for ${pictureName(p.imageId, i)}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {question.pairs.map((other) => (
                          <SelectItem key={other.labelId} value={other.labelId}>
                            {optionText(other.labelId)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </PanelRow>
                ))}
              </div>
            ) : null}

            {question.type === "sort" ? (
              <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-ink-2 text-meta">
                {question.order.map((id, i) => (
                  <li key={id} className="flex min-h-8 items-center gap-1">
                    <span aria-hidden data-tabular className="w-3 shrink-0 text-ink-3">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{optionText(id)}</span>
                    <IconButton
                      size="sm"
                      label={`Move ${optionText(id)} up`}
                      disabled={i === 0}
                      onClick={() => set({ ...question, order: moved(question.order, i, i - 1) })}
                    >
                      <ChevronUp aria-hidden {...ICON_SM} />
                    </IconButton>
                    <IconButton
                      size="sm"
                      label={`Move ${optionText(id)} down`}
                      disabled={i === question.order.length - 1}
                      onClick={() => set({ ...question, order: moved(question.order, i, i + 1) })}
                    >
                      <ChevronDown aria-hidden {...ICON_SM} />
                    </IconButton>
                  </li>
                ))}
              </ol>
            ) : null}
          </PanelSection>

          <PanelSection title={question.type === "open-response" ? "Model answer" : "Explanation"}>
            {question.type === "open-response" ? (
              <Textarea
                rows={4}
                value={question.modelAnswer ?? ""}
                aria-label="Model answer"
                placeholder="What a strong answer contains."
                onBlur={typing.end}
                onChange={(e) => type({ ...question, modelAnswer: e.target.value })}
              />
            ) : question.type === "true-false" || question.type === "multiple-choice" ? (
              <Textarea
                rows={3}
                value={question.explanation ?? ""}
                aria-label="Explanation"
                placeholder="Shown when the answer is revealed."
                onBlur={typing.end}
                onChange={(e) => type({ ...question, explanation: e.target.value })}
              />
            ) : (
              <p className="m-0 text-ink-3 text-meta">
                This question type reveals its answers on the slide itself.
              </p>
            )}
          </PanelSection>
        </div>
      </PopoverContent>
    </Popover>
  );
}
