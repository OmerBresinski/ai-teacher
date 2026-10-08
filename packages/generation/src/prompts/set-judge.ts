/**
 * The set judge: one call over all of a same-subject set's panels (TEACH-237). Is every panel the
 * same individual subject, each at the stage its own line names? `odd` lists the panels that break
 * the set (0-based). Ported byte for byte from base4's pinned prompt and schema;
 * `set-judge.test.ts` holds both sha256 pins. Bump `version` whenever the wording changes.
 */
import { z } from "zod";

export const SetJudgeSchema = z
  .object({
    same: z.boolean(),
    odd: z.array(z.number().int().min(0)),
    why: z.string(),
  })
  .strict();
export type SetJudgeVerdict = z.infer<typeof SetJudgeSchema>;

/** What each panel should show, in panel order. */
export interface SetJudgeInput {
  shows: string[];
}

export const SET_JUDGE_SYSTEM = `You check a set of pictures that one slide of a school lesson shows side by side as one subject at different stages, so that pupils read it as this one grows or changes into that one. The panels follow in order, each after a line saying what that panel should show.

Answer:
- same: true when each panel shows exactly the stage its own line names, no earlier and no later, and every panel shows the same individual subject: the same species, breed or kind, with the same colouring and markings except where the stage itself changes them as the panel lines say, each one whole inside its panel, seen from a similar viewpoint and camera distance. Only the stage, age or state changes from panel to panel, so an earlier stage may look smaller and differently proportioned: a size difference that follows the stages is correct, and a pose or angle a line mentions is a framing hint, not a requirement.
- odd: the 0-based indexes of the panels that break the set: a different kind, a different colouring or markings, a subject cut off or hidden, or a stage that is not the one its line names. Empty when same is true.
- why: one sentence naming what you saw that decided the answer.
`;

export const setJudgePrompt = {
  version: "set-judge.v1",
  system: SET_JUDGE_SYSTEM,
  user(input: SetJudgeInput): string {
    return input.shows.map((s, i) => `Panel ${i + 1}: ${s}`).join("\n");
  },
};

/** The answer is three short fields; base4 capped it at 2000 tokens. */
export const SET_JUDGE_TOKENS = 2000;
