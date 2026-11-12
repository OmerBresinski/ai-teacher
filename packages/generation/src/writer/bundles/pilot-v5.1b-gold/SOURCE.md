# pilot-v5.1b-gold (11 Nov 2026, lab runs only, selected by id `v5.1b-gold`)

A copy of `pilot-v5.1-gold` with one prompt edit (`scratchpad/tuning/v5.1-gold/V51B-NOTES.md`): the discussion line
asks for a question with more than one fair answer and a lead that is a claim to argue, never the answer
(v5.1-gold proof, Y2 Great Fire s8: the lead answered the question). The model blocks are v5.1-gold's own files.
Code, this pack only: a figure code drops from a picture-and-text slide keeps the gold no-picture look, not explain.

v5.1-gold's source notes follow.


Drafted in `scratchpad/tuning/v5.1-gold/` (CHANGES.md, RISKS.md, WIRING.md), wired by the prompt engineer
(`scratchpad/tuning/v5.1-gold/WIRED-NOTES.md`). Base v5.0b. Diagnostic arm under METHOD rule 1 (clause D).

- `system-KS{1,2,3}.template.txt`: every limit is a `{{fits:<name>}}` slot, filled by `pilot-v51-gold.ts`
  `v51System` from the gold-measured tables (`fit-table-gold.gen.json`, the gold `*-capacity.json`,
  `PT_CAPS` / `KEY_FIT` / `KEY_CAPS`). Diagram-kind counts stay typed: no gold draws a data diagram.
- `wave-c-model-line.txt`, `wave-c-step-model-line.txt`: the pack's own model blocks (`withV51ModelLines`),
  sent only with a Models list. The live packs keep the library line and `withWaveCLibrary`.
- Wiring edits to the draft (WIRED-NOTES "Decisions"): figure-slide holds a photo or a library model only and
  one a lesson (code's ruling-229 rule); drawn diagrams sit beside words; notation block per NOTATION-PLAN 4a.
