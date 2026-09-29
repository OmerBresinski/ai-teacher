import type { SlideSpec } from "@tj/slides";

/*
 * Full slides, for size (lab fit-calibrate-by-example, 29 Sept 2026). Three slides written at
 * capacity on the real layouts, shown to the teach call and the slide writer as "this is one
 * slide's worth" in place of character and word numbers. Measured with the editor's own fit
 * (`slidesNeedingFit` + the callout's placement, `measureHeadless`) on all ten themes: each fits
 * on 10/10, and a few more words break it (one-idea body + one short sentence: callout dropped
 * on 8/10; one step wrapping to a second line: lint on 9/10). The topics are chosen away from the
 * lab briefs on purpose. If a layout or theme changes, re-measure (full-slides.test.ts) before
 * editing the text.
 */

type Full = { label: string; spec: SlideSpec };

export const FULL_SLIDES: readonly Full[] = [
  {
    label: "a content slide with one key idea and a watch-out card",
    spec: {
      kind: "content",
      factRefs: [],
      heading: "Rivers wear away their beds and make valleys deeper",
      body: "Fast water rolls stones along the bed, and they grind it away. Hill streams have cut steep V-shaped valleys this way.",
      callout: {
        kind: "watch-out",
        text: "Rivers do not stay the same; they slowly reshape the land.",
      },
    },
  },
  {
    label: "a content slide with two key ideas sharing the same room",
    spec: {
      kind: "content",
      factRefs: [],
      heading: "Rivers wear land away in one place and drop it in another",
      body: "Fast water grinds the river bed with stones, so valleys get deeper.\n\nSlow water drops its mud: the Nile built a delta this way.",
      callout: {
        kind: "watch-out",
        text: "Rivers do not stay the same; they slowly reshape the land.",
      },
    },
  },
  {
    label: "a worked example",
    spec: {
      kind: "worked-example",
      factRefs: [],
      heading: "Add all four sides to find a perimeter",
      question: "Suppose a garden is a rectangle 7 m long and 4 m wide. What is its perimeter?",
      steps: [
        "A rectangle has two lengths and two widths.",
        "Two lengths: 7 m + 7 m = 14 m.",
        "Two widths: 4 m + 4 m = 8 m.",
        "Perimeter = 14 m + 8 m = 22 m, all the way round.",
      ],
    },
  },
];

function render({ label, spec }: Full): string[] {
  const lines = [`Full slide, ${label}:`];
  if ("heading" in spec && spec.heading) lines.push(`  Heading: ${spec.heading}`);
  if (spec.kind === "content") {
    for (const para of spec.body.split("\n\n")) lines.push(`  Text: ${para}`);
    if (spec.callout) lines.push(`  Card: ${spec.callout.text}`);
  }
  if (spec.kind === "worked-example") {
    lines.push(`  Question: ${spec.question}`);
    spec.steps.forEach((step, i) => {
      lines.push(`  Step ${i + 1}: ${step}`);
    });
  }
  return lines;
}

/** The three full slides as prompt text, one field per line. */
export const FULL_SLIDES_BLOCK = FULL_SLIDES.flatMap(render).join("\n");
