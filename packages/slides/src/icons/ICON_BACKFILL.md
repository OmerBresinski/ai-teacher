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
3. **Draw.** Otherwise an in-session agent batch draws the new concepts (no paid API), following
   the style guide in the pilot's `ICONS.md`: 240x240 box, the helpers in `kit.ts` only, colours
   only from the slots in `treatment.ts` (`ICON_PALETTE` names and the theme's `icon-*` slots) or
   `#fff`, 3-4 shapes for scene-like concepts, and a separate `small` drawing when the medium one
   does not read at about 47pt. Add each drawing to the set file for its topic (or a new set file
   spread into `ICON_LIBRARY` in `library.ts`) and its `{ id, label, synonyms }` to the concepts.
4. **Vet.** Render a contact sheet of the new drawings at the three ages and sizes s, m and l
   (as for TEACH-310 part b) and redraw any that do not read. `library.test.ts` checks every
   drawing parses, has literal colours only and resolves; `match.test.ts` checks no label or
   synonym collides with another concept.
