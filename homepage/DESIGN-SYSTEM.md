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

## Components

`button(label, route, {secondary})`: one dark primary action and an understated text secondary action. `appButton(label, path)` is the same control pointing into the application. Creating a lesson is the main action everywhere.

`character(kind, {className})`: original Plan (`support` SVG key), Slides, Worksheet (`activity` key), Check (`answers` SVG key). Passive wrappers are hidden from assistive technology; surrounding meaningful links carry names. Hover and keyboard focus trigger signature gestures when interactive.

`pageHero({eyebrow,title,description,character,actions})`: one H1, brief explanation, optional relevant character. No mandatory character on text-heavy or form pages.

`split({eyebrow,title,body,visual,reverse,tone})`: one idea with material proof. Alternate direction for reading rhythm; keep images tied to the claim.

`cta({title,body,actions})`: warm closing section with one Check character. Title, body and actions are always supplied so the closing action never links to the page it sits on.

Other system parts: mobile disclosure navigation, FAQ details, the hero topic form with its upload link and tooltip, the example image galleries with the answer-key disclosure, reading-column pages and scrolling policy tables.

## Blocks and composition

1. Grounded hero with the original four-character team behind the topic form. The form is a real
   `GET` into the application, so it works with JavaScript disabled.
2. Example lessons: one slide image per lesson, its brief and a link to the lesson page. Both the
   heading and the count come from the manifests the build actually emitted.
3. Three steps, one line each: say what you are teaching, get the whole lesson checked, make it
   yours.
4. Teacher control, then five short FAQ answers with a link to the full set.
5. Closing invitation back to the topic form.

The site sells one flow: a brief in, a whole lesson out, edit, present or export. Example lesson
pages are image galleries read from a manifest, with the answer key behind a disclosure.
Information and policy pages use the reading layout; wide policy tables scroll inside their own
column so the page never does.

## Motion

The original cast rig supplies independent ambient behaviours and one signature per character.
Marketing adds a quiet body-life layer and signatures soften it. Offscreen actors stop. User pause
persists through scrolling and reduced-motion preferences suppress animation. One full team is
enough per page; isolated characters accompany specific material context. The hero cast is
ambient art: plan, slides, worksheet and check.
