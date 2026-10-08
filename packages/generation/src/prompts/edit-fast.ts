/*
 * Edit with a prompt, fast path (TEACH-97 part d; rulings 171-176). One call on gpt-6-luna with
 * reasoning off, over the text box (or whole slide) a teacher selected. v3/v4 (8 Oct 2026) are the
 * tested v2 fast prompt from the research harness
 * (`scratchpad/quality-prd/research/edit-agent/prompts/fast.v2.txt`, 14 of 15 cases at a 1.5 s
 * median, 7 Oct 2026) fitted to this packing: element-text addresses, no template or slot limits
 * (fit is checked in code), the thread history from `chain.ts`, and refusals in teacher words with
 * an offer field (v4), follow-ups that keep the last direction, and no answer in reason or summary.
 * The user turn is packed the way the harness packs it (`packFast` in `edit.ts`).
 * Wording changes go through prompt-engineer; bump `version` whenever it changes.
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
  /**
   * The thread's earlier turns, oldest first; the prompt shows the last 3. `slides` are the paths
   * the turn changed (`s4`). Wording from the research harness (`chain.ts` `historyText`).
   */
  history?: { instruction: string; summary: string; slides: string[] }[] | undefined;
  /** The second attempt: the checks the first answer failed, and that answer. */
  retry?: { faults: string[]; previous: string } | undefined;
};

export const editFastPrompt = {
  version: "edit-fast.v4",
  system:
    'You edit the part of a school lesson that a teacher has selected. You get the lesson brief and objectives, a one-line outline of every slide, the selected slide as JSON with the text of each text box, the selected text box when there is one, the earlier edits in this thread when there are any (read an instruction that refers back, such as "a bit more" or "the other box", against them), and the teacher\'s instruction.\n\nMake the smallest change that does what the teacher asked, inside the selection, written for the brief\'s year group and reading level. When a text box is selected, change only that box; when the whole slide is selected, change any of its text boxes the instruction is about. "A bit more", "more" or "again" asks for more of what the last edit did, in the same direction: after "Shorter", shorter again; after "Harder", harder again. When the text cannot go further that way and stay right, changes is empty and summary says so.\n\nEach change replaces one text box\'s text: name the box by its path, using its id from the slide JSON ("s4/elements/aB3dE9/text"), put the new text in `text`, and set `node_json` to null.\n\nAnswer with the JSON keys `action`, `reason`, `offer`, `changes` and `summary`. `reason` and `summary` never state the answer to a question on the slide or which option is correct. Set `action` to one of:\n- edit: changes holds the edit, reason and offer are null, and summary says what you changed in one short sentence for the teacher.\n- escalate: the instruction needs more than this selection (other slides, adding or removing slides, a new picture, diagram or animation, or facts that need a source). changes is empty, reason says what it needs, and offer is null.\n- refuse: the change would make the lesson wrong, for example untrue, or giving an answer away. changes is empty; reason is one plain sentence for the teacher that says only why, with no paths, ids or field names and without naming the answer; and the alternative goes in offer: a different change you can make that keeps the lesson right, as a short instruction the teacher could send you ("Add a hint about how the particles move").',
  user(input: EditFastInput): string {
    const history = (input.history ?? []).slice(-3);
    const parts = [
      `Lesson: ${input.lesson}`,
      `Objectives:\n${input.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
      `Outline:\n${input.outline.join("\n")}`,
      `Slide ${input.slidePath}:\n${input.slideJson}`,
      ...(input.text === undefined
        ? []
        : [`Selected element: ${input.target} = ${JSON.stringify(input.text)}`]),
      ...(history.length === 0
        ? []
        : [
            `Earlier edits in this thread (oldest first, summaries only; the lesson above is the current state, including any changes the teacher made by hand):\n${history
              .map(
                (h, i) =>
                  `${i + 1}. Teacher: ${JSON.stringify(h.instruction)} -> ${h.summary}${h.slides.length ? ` [${h.slides.join(", ")}]` : ""}`,
              )
              .join("\n")}`,
          ]),
      `Teacher's instruction: ${input.instruction}`,
    ];
    const user = parts.join("\n\n");
    if (!input.retry) return user;
    return `${user}\n\nYour last change failed these checks; fix them and keep to the instruction:\n${input.retry.faults.join("\n")}\n\nYour last answer:\n${input.retry.previous}`;
  },
};
