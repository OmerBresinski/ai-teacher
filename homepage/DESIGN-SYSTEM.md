# DayBack design system

## Foundation

The accepted direction is simple, friendly and polished, with personality coming primarily from the original paper characters. Gabarito is the sole typeface, loaded locally. Cream replaces baby blue as the page foundation. The design avoids heavy 3D, repeated decorative mascots, dense feature-card grids and unsupported marketing claims.

## Colour roles

| Token | Value | Role |
|---|---|---|
| cream | #fcf9ee | Page background |
| ink | #293b32 | Body text, headings, primary actions |
| muted | #526052 | Supporting text |
| paper | #fffef8 | Authored material surfaces |
| sage | #e5ecd8 | Context/support sections |
| sand | #f0dfc9 | Closing invitation |
| yellow | #f5c054 | Slides identity / selected artwork |
| salmon | #efa991 | Answers identity / selected artwork |
| line | #b9c3b0 | Decorative dividers, not sole control boundaries |
| control-border | #7d8b76 | Input and interactive-control boundary |

Ink/cream contrast is approximately 11.28:1; muted/cream 6.32:1. Illustration accents are not used as low-contrast body text. Colour is supplemented by wording, selection state, borders or icons.

## Typography and spacing

- Display: 44–84px responsive shared H1 role. Example lesson titles use a more compact scale.
- Section heading: 34–56px.
- Subheading: 24–32px, with compact semantic headings where needed.
- Body: 18px desktop / 16px mobile; lead 22px / 19px.
- Supporting UI text: 14px minimum. Small lettering inside decorative SVGs is artwork, not the sole source of information.
- Paragraph line height: 1.5–1.7; headings approximately 1.1. Reading columns are bounded; display lines are balanced.
- Sections: 64–112px. Main container: 1200px / 88% viewport. Two-column blocks collapse to one column on mobile.
- Shape roles: paper 3px, control 6px, card 12px, pill actions. Character outline shapes remain original artwork.

## Grid and rhythm

One grid for every page: `.container` is at most 1200px wide with a `--gutter` on each side, so
the header, every section, every page title and the footer share one left edge. Reading text is
capped at `--measure` (44rem) on that same edge, never centred in its own column. Sections use
`.section` for vertical rhythm; `tone-sage` and `tone-sand` are the only band colours, and two
cream sections in a row are separated by `section-ruled`, a rule on the grid.

## Components

`sectionHead({id, eyebrow, title, lede})`: how every section opens. Left-aligned, one H2.

`button(label, route, {secondary})`, `appButton(label, path)`, `createButton(home)` and
`textLink(label, route)`. Creating a lesson is the one primary action. Arrow roles are fixed: the
diagonal arrow goes into the application, the straight arrow stays on this site.

`character(kind, {className})`: original Plan (`support` SVG key), Slides, Worksheet (`activity`
key), Check (`answers` SVG key). Passive wrappers are hidden from assistive technology.

`pageHero({eyebrow,title,description,character,actions})`: one H1, brief explanation, optional
character. No mandatory character on text-heavy pages.

`cta({home, secondary})`: the one closing invitation, identical wherever it appears ("Start with
the lesson you’re teaching tomorrow."), with the Check character.

`lessonCard` / `lessonGrid` (`src/lesson-card.mjs`): a Top lesson as one link with its cover slide.

`faqList(items)` and `faqs` (`src/pages/information.mjs`): the one FAQ source. Home shows the
items marked `home`; /help/ shows all of them.

## Home composition

1. Hero: the four-character team behind the topic form (a real `GET` into the application).
2. Proof: one idea travelling from a slide to a worksheet question to its answer, drawn as
   illustration, not a screenshot. It renders finished; `proof.js` replays it once on scroll.
3. Top lessons: up to four lesson cards read from the manifests.
4. How it works: "Your idea. Your lesson. Your call." on the left; on the right the Slides
   character over three short lines (topic, complete lesson, change anything). It renders at
   rest; `how-it-works.js` plays the character's flipbook entrance once on scroll.
5. Questions teachers ask: the home FAQ items, heading on the left.
6. The closing invitation, back to the form.

The one tagline is the hero line, "Outstanding lessons. Without losing your evening." The footer
repeats it; no other slogans.

## Motion

The original cast rig supplies independent ambient behaviours and one signature per character.
Marketing adds a quiet body-life layer and signatures soften it. Offscreen actors stop, and a
reduced-motion preference suppresses animation. There is no manual pause control. The proof papers enter once on scroll, followed by a drum flourish and a quiet tapping loop.
Offscreen and hidden-tab motion pauses automatically. With reduced
motion or without JavaScript the finished state is shown. One full team is
enough per page; isolated characters accompany specific material context. The How it works
entrance (`motion/flipbook.js`) is drawn frame by frame, swapped on a stepped timeline with no
tweening, and clipped to the character's side of the section so it never crosses the heading. The hero cast is
ambient art: plan, slides, worksheet and check.
