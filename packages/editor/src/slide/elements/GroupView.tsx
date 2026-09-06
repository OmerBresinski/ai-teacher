import type { GroupElement } from "@tj/domain/documents";
import { useMemo } from "react";
import { ElementFrame } from "./ElementFrame";
import type { ElementViewProps } from "./kit";

/** Children live in the group's local space, so the frame is just a positioned box. */
export function GroupView({
  element,
  theme,
  mode,
  slideId,
  revealAnswer,
  question,
  step = Number.POSITIVE_INFINITY,
}: ElementViewProps<GroupElement>) {
  /** Position within the group of children sharing a reveal step, for the stagger. */
  const stagger = useMemo(() => {
    const seen = new Map<number, number>();
    const out = new Map<string, number>();
    for (const child of element.children) {
      const s = child.revealStep ?? 0;
      const n = seen.get(s) ?? 0;
      seen.set(s, n + 1);
      out.set(child.id, n);
    }
    return out;
  }, [element.children]);

  // A group that reveals as a whole owns the entrance; its children must not animate
  // inside it or the two transforms compound.
  const childrenAnimate = (element.revealStep ?? 0) === 0;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {element.children.map((child, i) => (
        <ElementFrame
          key={child.id}
          element={child}
          theme={theme}
          mode={mode}
          slideId={slideId}
          step={step}
          revealAnswer={revealAnswer}
          question={question}
          zIndex={i + 1}
          staggerIndex={stagger.get(child.id)}
          animateReveals={childrenAnimate}
        />
      ))}
    </div>
  );
}
