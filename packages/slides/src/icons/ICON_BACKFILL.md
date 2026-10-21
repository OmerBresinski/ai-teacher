# Icon backfill: how a missed concept becomes a drawing

The library is never drawn live. When a layout asks for an icon whose label does not resolve
(`resolveIcon` / `resolveIcons` return `null` and list it in `misses`), the slide falls back to
numbers and the caller reports the label as an icon miss (`iconMisses`). Misses are collected and
drawn in batches:

1. **Collect.** Gather the reported misses from runs. Keep only real concepts (an object, organ,
   place, process or quantity a pupil would picture); drop instructions and phrases.
2. **Synonym first.** If the miss is another name for a concept already here ("Arteries" for
   `artery`), add it to that concept's `synonyms` in the pilot's `pilot-concepts.json` and
   regenerate `concepts.ts` (`bun scripts/icon-concepts.ts <path>`). No drawing needed.
   **A wrong icon is worse than a number.** A one-word synonym goes in only if it means the
   same thing in every school subject ("smoke", "earth", "pressure", "core", "queen" do not);
   otherwise add the qualified phrase ("cigarette smoke", "blood pressure"). The generator's
   `DROP_SYNONYMS` strips the generic ones the pilot list carried, and `match.test.ts` checks
   other subjects' words resolve to nothing.
3. **Draw.** Otherwise an in-session agent batch draws the new concepts (no paid API), following
   the style guide in the pilot's `ICONS.md`: 240x240 box, the helpers in `kit.ts` only, colours
   only from the slots in `treatment.ts` (`ICON_PALETTE` names and the theme's `icon-*` slots) or
   `#fff`, 3-4 shapes for scene-like concepts, and a separate `small` drawing when the medium one
   does not read at about 47pt. Add each drawing to the set file for its topic (or a new set file
   spread into `ICON_LIBRARY` in `library.ts`) and its `{ id, label, synonyms }` to the concepts.
4. **Vet.** Render a contact sheet of the new drawings at the three ages and sizes s, m and l
   (as for TEACH-310 part b) and redraw any that do not read. `library.test.ts` checks every
   drawing parses, has literal colours only and resolves; `match.test.ts` checks no label or
   synonym maps to two concepts (exactly or after the plural fold) and that generic words from
   other subjects resolve to nothing.

## Since TEACH-310 part c

- **Where concepts live.** `concepts.ts` stays generated from the pilot list. Concepts for the
  layout sets (and later batches) are written by hand in `concepts-layouts.ts`; `catalogue.ts`
  joins the two lists, pilot first, and hands a pilot synonym over to a layout concept that owns
  it (`HANDED_OVER`: "scroll" now draws the stages scroll, not papyrus). When two concepts share a
  term the first keeps it (`buildIndex`); `match.test.ts` fails on any collision.
- **Scoped words.** A word that is a concept in one subject and something else in another goes in
  `SCOPED_TERMS` (`match.ts`) instead of being dropped: it matches only when the caller passes a
  `subject` containing one of the listed words (`matchIcon(label, index, { subject })`,
  `resolveIcons(labels, { subject })`). Today: "root" (science and plants; a square root in
  maths) and "shield" (history; a shield volcano in geography).
- **Natural colours.** Real things keep their own colours from `ICON_PALETTE`; eyes, noses and
  dark matter use `eye`, never the theme's `icon-ink` (light on a dark theme). Only man-made
  objects with no fixed colour take `icon-*` slots.
- **Medals.** `iconMedalSvg(id, { medal })` draws an icon at 80% of a disc whose face is the
  theme's `medal-fill` or `medal-tint` and whose ring is `medal-line` (or a category colour).
  `medalColoursFor({ tokens })` reads those kebab tokens from the theme's record; only a theme
  without them gets the final token set's derivation (the surface on light themes, a deep
  accent-hue face with a quiet ring on dark ones, ruling 247).
- **Dark on dark.** Each large shape of a drawing must read at 3:1 on the medal face. Where one
  does not (a black penguin on a deep face), the medal draws a soft light rim behind the drawing
  in the ring's hue, on that theme only (`medalRim`); `medal.test.ts` checks all icons on Slate and
  Ember. A new drawing needs no per-theme work.
- **Load it lazily.** The module is about 48 KB gzipped with 201 drawings (30 KB at part b) and
  the lesson editor's chunk has about 5.7 KB headroom. Wire it with a dynamic
  `import("@tj/slides/icons")`, never a static import, from the editor or the web app;
  `lazy.test.ts` walks every client source (web, editor, slides, ui, domain, api-client) and fails
  on any static import of it: named, side-effect or re-export, by package name or relative path.
