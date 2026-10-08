# P4 notes: diagram drawer port (P3 / TEACH-247 part a, drawer only)

Branch `port/p4-diagrams` from origin/master 1436c659. Source: lab/ab pin 92f1b36d. Not pushed.

## Ported
- `packages/slides/src/diagrams/**` byte for byte from the pin (schema, wire, meaning kinds, flow graph, cubes, groups, fraction shapes, limits, drawer-strict schema, all renderers and their tests).
- `@tj/slides/diagrams` subpath export; nothing added to the root barrel.
- Renames (lab names out): `samples.ts` -> `fixtures.ts` (test and visual-page fixture, no longer exported from the index); `h1-specs.json` -> `writer-specs.fixture.json`. Lab tags stripped from comments (35 lines); 33 remain in test names and string literals.
- Not ported, as the draft says: `round8.test.ts`, `g1.test.ts`, `h1.test.ts`, `meaning-samples.ts`.
- `themes.ts`: an additive subset of the lab's key-stage type scale (`KeyStage`, `KEY_STAGE_TYPE`, `BODY_SMALL`, `keyStage`, `setKeyStage`, `withKeyStage`, `typeScale`). With no stage set (all of production), `typeScale` is undefined and nothing changes. The lab's proxied, stage-bound `THEMES` and `getTheme(id, ageBand)` are NOT ported; one test call changed from `getTheme("studio", "ks5")` to `getTheme("studio")` inside `withKeyStage("ks5")`.

## Held back, and why
1. **Slot wiring** (`look.ts` `withDiagramSlot` taking a spec, `materialise.ts` `withDiagramDrawn`, chunk stack beside the drawing): it relays the writer's slide layout, so it needs P2a/P2b. Two describe blocks dropped from `diagrams.test.ts` for this.
2. **Figure templates (resolved).** The lab's `figures/*` now sits in `packages/slides/src/diagrams/figures/`, byte for byte apart from import paths and comment tags. It is the drawer's own copy; production's `src/figures` stays as it is. `audit-guards.test.ts`, `geometry.test.ts` and `normalise.ts` use the drawer's copy, and nothing is skipped any more. `src/figures/production-snapshot.test.ts` freezes objectives-first's figures: every template on every theme at two sizes. It was written and committed (f252f786) before any change, and it still passes unchanged after them.
   - **The geometry hang was a real production bug.** Master's `figures/energy-profile.ts` fit loop never ends when a label cannot lose a line, for example `{reactants: "", products: "", activationEnergy: -1, energyChange: 4}` in a 160x300 zone. `drawFigure` accepts those values because `shape` parses them, so it could hang a worker. The lab fixed it with a guard, and commit 2bb6fb6e applies that guard to production with a regression test. The snapshot is unchanged, so every drawing that ended before still draws the same. It may be worth its own PR.
3. **Needs P3 (the writer):** `r2.ts` (`writerSpecOf`, `labelsOf`), `arm-t.ts` `r2Ask`, the Luna drawer fallback call (`diagram-spec.txt`), and acceptance rows 1–3 and 5 (replay of base4's 23 writer outputs, drawn ratio, no filled totals on questions, freeform -> Luna). Row 6 (editor/present/PDF/PPTX) needs the slot wiring. Row 7 (bundle size) is not measured yet.

## Verification ($0)
- `bun test packages/slides`: 4229 pass, 0 skip, 0 fail. `geometry.test.ts` runs in 1.6 s.
- `bun run typecheck`: 17/17 tasks. Biome: 0 errors (warnings only).
- Renders, 1440 wide, light colour scheme, every sample kind: `/private/tmp/claude-501/-Users-gregwallace-Documents-experiments-ai-teacher/dd8ffc34-c235-4f81-8067-3b4957d682fb/scratchpad/pr-shots/p4-diagrams/{chalk,studio,exam-hall}-1440.png` (from `bun packages/slides/src/diagrams/visual.ts`). Looked at chalk and studio: every kind draws, labels inside their boxes, no clipping seen. Studio draws flow-chain as a vertical stack, chalk as a 2x2 loop (lab behaviour).
