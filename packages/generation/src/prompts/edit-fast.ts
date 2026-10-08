/*
 * Edit with a prompt, fast path (TEACH-97 part d; rulings 171-176). One call on gpt-6-luna with
 * reasoning off, over the text box a teacher selected. The system prompt is the tested v2 fast
 * prompt, ported verbatim from the research harness
 * (`scratchpad/quality-prd/research/edit-agent/prompts/fast.v2.txt`, 14 of 15 cases at a 1.5 s
 * median, 7 Oct 2026). The user turn is packed the way the harness packs it (`packFast` in
 * `edit.ts`). Wording changes go through prompt-engineer; bump `version` whenever it changes.
 *
 * Not in `PROMPTS`: the text is the tested one, which does not carry `HOUSE_RULES`.
 */

export type EditFastInput = {
  /** One line about the lesson: year group, subject, topic, reading level. */
  lesson: string;
  objectives: string[];
  /** One line per slide: its path, kind and heading. */
  outline: string[];
  /** The selected slide, as `{ kind, elements: { <id>: { text } } }` JSON. */
  slidePath: string;
  slideJson: string;
  /**
   * The selected node: `s4/elements/<id>/text` with its `text`, or the whole slide (`s4`, no
   * `text`), packed as the harness packs a slide selection (no "Selected element" line).
   */
  target: string;
  text?: string | undefined;
  instruction: string;
  /** The second attempt: the checks the first answer failed, and that answer. */
  retry?: { faults: string[]; previous: string } | undefined;
};

export const editFastPrompt = {
  version: "edit-fast.v2",
  system:
    'You edit the part of a school lesson that a teacher has selected. You get the lesson brief and objectives, a one-line outline of every slide, the selection as JSON with its template\'s slot limits, and the teacher\'s instruction.\n\nMake the smallest change that does what the teacher asked, inside the selection, written for the brief\'s year group and reading level. Keep the selection\'s template and keys, within its slot limits.\n\nEach change replaces one node, named by its path: a slide ("s4"), a part of a slide ("s4/columns/1/text") or a worksheet block ("ws/w5"). When the node is text, put the new text in `text`. Otherwise put the whole new node, as JSON, in `node_json`. The other field is null.\n\naction:\n- edit: changes holds the edit, reason is null, and summary says what you changed in one short sentence for the teacher.\n- escalate: the instruction needs more than this selection (other slides, adding or removing slides, a new picture, diagram or animation, or facts that need a source). changes is empty and reason says what it needs.\n- refuse: the change would make the lesson wrong, for example untrue, or giving an answer away. changes is empty and reason tells the teacher why in one plain sentence, and what you can do instead.',
  user(input: EditFastInput): string {
    const parts = [
      `Lesson: ${input.lesson}`,
      `Objectives:\n${input.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
      `Outline:\n${input.outline.join("\n")}`,
      `Slide ${input.slidePath}:\n${input.slideJson}`,
      ...(input.text === undefined
        ? []
        : [`Selected element: ${input.target} = ${JSON.stringify(input.text)}`]),
      `Teacher's instruction: ${input.instruction}`,
    ];
    const user = parts.join("\n\n");
    if (!input.retry) return user;
    return `${user}\n\nYour last change failed these checks; fix them and keep to the instruction:\n${input.retry.faults.join("\n")}\n\nYour last answer:\n${input.retry.previous}`;
  },
};
