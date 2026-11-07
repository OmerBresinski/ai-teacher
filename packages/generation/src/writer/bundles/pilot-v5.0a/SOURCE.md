# Pilot pack v5.0a (3 Nov 2026): back to basics

Written by the prompt-engineer agent (Opus 5.5). Test runs only, selected with `TJ_PILOT_PACK=v5.0a`.
Base: live v4.17. Schema, layouts, switches and writer model are v4.17's; only the system text differs.

- `system-KS{1,2,3}.template.txt`: a short first-principles brief and the constraints code needs, with every
  `{{fits:*}}`, `{{menu:*}}` and `{{rule:*}}` slot of v4.17. The diagram kinds and fill shapes are copied
  verbatim from v4.17's templates of the same stage.
- `../../pilot-v50a.ts`: each code-built menu line keeps its generated `Fits:` text; the prose before it is
  replaced by a short line saying what the layout is and what its fields hold.

Rationale, kept and dropped rules: `scratchpad/tuning/v5.0a/` (PROGRESS.md, DROPPED.md) and
`scratchpad/tuning/gateA-v5.0a.md`.
