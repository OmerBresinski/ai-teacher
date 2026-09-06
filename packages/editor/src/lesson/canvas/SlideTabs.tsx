import { type Slide, slideStepCount } from "@tj/domain/documents";
import { Tabs, TabsList, TabsTrigger } from "@tj/ui";
import { CircleCheck, CircleHelp } from "lucide-react";
import type { RefObject } from "react";
import { Panel } from "../../kit/Panel";
import { useAnswerShowing, useSessionActions, useSessionUi } from "../use-editor-session";
import { CHROME_MIN_TOP, placeSlideActions } from "./place-slide-actions";
import { useSlideChrome } from "./use-slide-chrome";

const ICON = { size: 16, strokeWidth: 1.5 } as const;

type SlideState = "question" | "answer";

/**
 * Question and Answer, above the top-left of a question slide (TeachDeck
 * `components/v2/editor/canvas/SlideTabs.tsx`). The two states of a question slide are what the
 * teacher is switching between, so they belong in front of the slide rather than behind a switch in
 * a corner. Screen space, like the action pill it mirrors, and the same disappearing act while text
 * is being edited or the slide is being dragged.
 *
 * It writes `previewAnswer`, the same flag every other route into the answer state writes. The last
 * reveal step is the answer too (SPEC §6), so the tabs read that as well; picking Question steps
 * back off that last step.
 */
export function SlideTabs({
  slide,
  stageRef,
  stageId,
  scale,
}: {
  slide: Slide;
  stageRef: RefObject<HTMLDivElement | null>;
  /** Id of the slide stage, which is what the two tabs switch between states of. */
  stageId: string;
  scale: number;
}) {
  const { setPreviewAnswer, setPreviewStep } = useSessionActions();
  const { previewStep } = useSessionUi();
  const isQuestion = !!slide.question;
  const steps = slideStepCount(slide);
  const showing = useAnswerShowing(slide);
  const { barRef, frame, size, viewport, hidden } = useSlideChrome({
    stageRef,
    deps: [slide.id, scale, isQuestion, showing],
  });

  if (!isQuestion || hidden || !frame) return null;

  const { left, top: placedTop } = placeSlideActions({
    slide: frame,
    pill: { w: size.w, h: size.h },
    viewport,
    align: "start",
  });
  const top = Math.max(placedTop, CHROME_MIN_TOP);

  const pick = (value: string) => {
    const answer = (value as SlideState) === "answer";
    setPreviewAnswer(answer);
    // The final step is its own answer reveal, so leaving the answer state has to step off it too.
    if (!answer && steps > 0 && previewStep >= steps) setPreviewStep(Math.max(0, steps - 1));
  };

  return (
    <Panel
      ref={barRef}
      data-slide-tabs
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 41,
        visibility: size.w === 0 ? "hidden" : undefined,
      }}
    >
      <Tabs value={showing ? "answer" : "question"} onValueChange={pick}>
        <TabsList aria-label="Slide state">
          <TabsTrigger value="question" aria-controls={stageId}>
            <CircleHelp aria-hidden {...ICON} />
            Question
          </TabsTrigger>
          <TabsTrigger value="answer" aria-controls={stageId}>
            <CircleCheck aria-hidden {...ICON} />
            Answer
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </Panel>
  );
}
