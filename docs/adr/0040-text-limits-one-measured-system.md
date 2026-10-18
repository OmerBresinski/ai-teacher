# ADR 0040: One measured system for text limits

- Status: Proposed (18 Oct 2026)
- Amends: ADR 0025 §9 (fitting numbers in `metrics.ts`). Builds on TEACH-70 (headless line counts) and TEACH-28 (the
  headless ruler).
- Checks: `packages/slides/scripts/measure-calibration.ts` (`bun run measure:calibrate`) and
  `packages/slides/scripts/caps-check.ts` (`bun run caps:check`), run by the `text-measure` CI job.

## Context

A text limit is decided in four places that do not share one definition. The advance table
(`font-metrics.generated.ts`) holds printable ASCII only, at four weights. Every other character counts as 1 em, and
20% of real lesson strings hold one (`’`, `—`, `…`, accents, maths signs). Weight 800 is read from the 700 table,
so Paper and Poster headings measure 2% narrow and can wrap in the browser after the ruler said they fit. Kerning and
px letter spacing are ignored. Capacities come from 21 scripts with six probe texts (5.0 to 6.0 characters a word),
different search steps, and titles measured apart from bodies. One table no longer regenerates (figure: 210 vs 60/67/79),
two generators print to stdout only (hinge, source) and one has no entry point (worked). The writer then turns characters into words with three
constants (8, 5.8/6.6/7.0, 5.4) and applies a 75% share on top. At KS3 that shows 0.60 of the words the slide held.

Measured against Chromium 151 on 44,892 layouts (`measure:calibrate --full`), the wrap rule itself is right. ASCII English at a correct weight
matches to 0.00% median width with kerning off and gives exact line counts 98.5% of the time. The faults are coverage
and duplication.

## Decision

1. **One ruler.** `measureText(text, {font, weight, px, letterSpacing, lineHeight, width})` in
   `packages/slides/src/measure/` returns lines, line widths and height. It keeps today's wrap rule (`breakRuns`, which
   matches `slide.css`). It reads a generated table covering every code point the editor's font CSS draws (latin and
   latin-ext subsets, punctuation, arrows, maths signs, fractions, super- and subscripts), with fallback-face widths
   measured in Chromium. The table has every weight a theme uses, kerning pairs of 2/1000 em or more, and em and px
   letter spacing. It counts graphemes, not UTF-16 units. The headless ruler, the editor's no-DOM fallback, the PPTX
   sizer and the capacity generator all call it. `SAFETY`, `FIT_CUSHION` and `WRAP_SLACK` merge into one named
   tie cushion.
2. **A stated bound, tested.** The target, after M2: one-line width within ±0.5% of Chromium (p1 to p99), line
   counts equal to Chromium's in at least 99.5% of layouts and short in no more than 0.05%. Until then
   `measure:calibrate` enforces today's measured bound (`CURRENT`: 97.9% exact, at most 0.5% short, width −1.8% to
   +2.45%) on the clean rows, and prints the target; `--target` enforces it. The calibration is a script that drives
   Playwright's Chromium, not an e2e test. CI runs a fixed sample (every theme face × weight × 2 sizes × 3 spacings
   × 2 widths, on real English, French, Spanish and maths text); `--full` runs 3 sizes, 4 spacings and 3 widths.
3. **One slot registry and one generator.** Every text slot of every layout is declared once as data (role, lines,
   counts, variants). One generator walks registry × theme × stage × variant through `layoutTemplate` at the drawn size
   (`resolveFontSize`). It fills the title and the bodies together, so a body's cap holds under the tallest title the
   title's cap allows. It writes `capacity.generated.json` with input hashes.
4. **Capacity is defined on real text.** `capacity(slot, {lines, stage})` is the largest number of graphemes, and
   separately words, such that at least 95% of real lesson strings of that length, from a checked-in corpus per stage
   and language, fit on every theme. No probe text, and no characters-per-word constant anywhere downstream.
5. **Words once.** The writer reads `words` from the table. The share policy (`SHOWN_SHARE`, `PLAN_SHARE`, minimums,
   need caps) lives in one module in generation and is applied once.
6. **Drift is a CI failure.** `caps:check` reruns every capacity generator on a temp copy of `src/` and diffs each
   table it produces (written or printed) against the checked-in JSON. From M2 it also regenerates the font table.

7. **Known gaps are listed, not hidden.** Both checks carry a list of today's gaps, each with its reason
   (`KNOWN_GAPS` in the calibration: weight 800, weight 500, px spacing, non-ASCII; `KNOWN` in the drift
   check: figure drift, pinned to the value its generator writes today, stdout-only and no-entry generators). The
   calibration judges each combination of gaps as its own bucket against its measured value plus a stated margin
   (2 points of exact, 1 of short, 1% of width). A gap that gets worse fails; a gap that closes also fails until it is removed from the list, so the lists only shrink.

## Consequences

- Caps rise where 1 em fallbacks and probe guesses kept them low (French, maths, text with curly quotes). They fall
  slightly for 800-weight headings, which were measured too narrow. All capacity JSONs change once, in one PR (M2).
- A new layout registers its slots instead of writing a capacity script. A new font or weight cannot ship unmeasured,
  because the generator derives faces and weights from the themes.
- Each font, Chromium or corpus change regenerates the tables. The calibration test catches metric shifts before
  users do.
- Bundle: about 5 KB gzip more in the slides chunk, kept out of the initial load.
- Migration: M0 (this ADR's checks, new files only), M1 (figure table, generator entry points), M2 (font
  table v2 and one regeneration of every table), M3 (slot registry and one generator), M4 (writer reads
  words), M5 (old scripts deleted). Table and capacity changes land after the in-flight theme PRs, writer
  changes after #572 and #583.

## Alternatives considered

- **Measure capacities in Chromium directly, keep the headless table as is.** This is exact for the tables, but the
  layout code's own fit decisions still run headless and would disagree with them. Rejected: the two rulers have to be
  one.
- **Shape with HarfBuzz (harfbuzzjs) server-side.** This gives exact shaping without a table, but adds a ~300 KB wasm
  to the editor path, and Chromium remains the truth to calibrate against. Kept as a fallback if the kerning-pair
  table cannot meet the bound.
- **Keep per-layout scripts and add a drift check.** This catches staleness but keeps six probe texts, separate
  title and body measuring, and three conversions. Rejected.
