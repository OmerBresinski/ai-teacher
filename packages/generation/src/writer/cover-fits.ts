import CAPACITY from "@tj/slides/templates/cover-capacity.json" with { type: "json" };

/*
 * The cover's fit (ruling 21 A, TEACH-215 part e), from the renderer's measured table
 * (`cover-capacity.json`), never hand-copied: the gold's three title lines and two question lines,
 * with a picture (the narrowest column) and without. It replaces the lab's title row in the fit
 * table (`fitTable`), so `charsOver` repairs an overlong title or question.
 */
type Cap = { title: number; question: number };

const capOf = (group: string, picture: boolean): Cap | undefined =>
  (CAPACITY as Record<string, Record<"picture" | "none", Cap>>)[group]?.[
    picture ? "picture" : "none"
  ];

/** The cover's layout entry in the fit table at a stage group (undefined: keep the lab's). */
export function coverFit(group: string) {
  const pic = capOf(group, true);
  const none = capOf(group, false);
  if (!pic || !none) return undefined;
  const variant = (label: string, figure: boolean, c: Cap) => ({
    label,
    counts: {},
    figure,
    keyCards: false,
    chars: c.question,
    ceiling: c.question,
    heading: c.title,
    limit: { item: c.question, total: c.title + c.question },
  });
  return {
    fields: ["lead"],
    variants: [variant("with picture", true, pic), variant("no picture", false, none)],
  };
}
