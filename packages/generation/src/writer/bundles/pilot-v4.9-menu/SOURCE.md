Pilot writer pack v4.9 (TEACH-110 part aq, 26 Oct 2026). Production's pack (`PILOT_PACK_ID`); v4.8 stays as shipped in `pilot-v4.8-menu` for comparison.

- system-KS*.template.txt = the v4.8 templates with three lines changed, the same in every key stage:
  - step 3: the writer writes one slide for each flow entry, in the flow's order (title slide 1, `slides` slide 3 to the one before the last, `close` the last), ends only at the flow's last entry and adds none it does not list.
  - the count line counts the close with the title and objectives, and numbers the flow from 1 with no gaps.
  - the picture line: a named subject is a named person, a real site (the Pudding Lane bakery), a monument, a unique artefact or document (the Rosetta Stone), or one particular event; an ordinary object of a period is generic (a leather fire bucket, a hand water squirt). Ruling 296: AI pictures may show generic period objects; real places, monuments, people and unique artefacts stay real-only.
- The pack sets `tierSlides`: `slides` takes the production schema's bounds for the tier, as `flow` already did. Before it, the pack bases fixed `slides` at 7..10 (6..9 with `close`), so every tier wrote 9 to 12 slides and a Detailed plan of 13 to 16 had to close early, off its own flow.
- system-KS*.snapshot.txt = the assembled text (`assembleWriterSystem` + `withFits`), pinned by pilot-v49.test.ts. Regenerate, never edit by hand.
