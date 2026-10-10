# 0038 — The teacher picks a slide length tier; the writer picks the count inside it

- Status: accepted
- Date: 2026-10-10
- Ticket: TEACH-110 part n
- Related: ADR 0036 (exact count, amended here), ruling 164 (slide tiers), ADR 0029 item 9

## Context

ADR 0036 made the writer's count exact because the brief offered exact counts (6, 8, 10, 12) and a
teacher who asked for 10 got 12. Ruling 164 (Greg, 6 Oct; restated 10 Oct) is a product decision
the other way: the teacher picks a **tier**, Quick 6–8, Standard 9–12 (the default) or Detailed
13–20, and the writer chooses the exact count within it. The lab already ran this way: its briefs
say "Slides: 9 to 12", the pinned user turn renders `{{slides.min}} to {{slides.max}}`, and
`COUNT_LINE` (`writer/contract.ts`) tells the writer to choose inside a range.

## Decision

1. `Brief.slideTier` (`"quick" | "standard" | "detailed"`, `@tj/domain` `SLIDE_TIERS`,
   `SLIDE_TIER_RANGES`) is what the brief screen sends and what `lessonFromBrief` defaults to
   (`DEFAULT_SLIDE_TIER`, Standard). New lessons carry no `slideCount`.
2. `slideRange(brief)` (`stages/write.ts`): a tier gives its range; a brief with only a
   `slideCount` (a lesson made before tiers) keeps ADR 0036's exact count; neither gives
   Standard. The writer's strict schema (`flow` min..max) holds the writer to the range; that is
   the code enforcement. No prompt text changes.
3. The outline planners (`objectives-first`, `facts`) build an exact count and only know 6–12:
   `plannerSlideCount(brief)` gives the brief's own count, else 8 / 10 / 12 for Quick / Standard /
   Detailed.
4. The plan screen's confirm sends `slideTier`. A tier the stored brief does not already stand
   for (`slideTierOf`: its tier, else the tier its count falls in) replaces the tier or count and
   re-plans pinned, as a new count did. The same tier keeps an older lesson's exact count.
5. There is no advanced exact-count setting in the product; `slideCount` stays accepted by the API
   for older clients and stored lessons.

## Consequences

- ADR 0036 §1 now applies only to briefs without a tier. Its count-miss log stays for those.
- A Detailed lesson on an outline planner gets 12 slides, the most those planners build.
