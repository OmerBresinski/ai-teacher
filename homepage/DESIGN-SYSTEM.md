# LessonCo / Good Company design system

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

- Display: 44–84px responsive shared H1 role; select sample titles use a more compact scale.
- Section heading: 34–56px.
- Subheading: 24–32px, with compact semantic sample headings where needed.
- Body: 18px desktop / 16px mobile; lead 22px / 19px.
- Supporting UI text: 14px minimum. Small lettering inside illustrative SVGs is artwork, not the sole source of information.
- Paragraph line height: 1.5–1.7; headings approximately 1.1. Reading columns are bounded; display lines are balanced.
- Sections: 64–112px. Main container: 1200px / 88% viewport. Two-column blocks collapse to one column on mobile.
- Shape roles: paper 3px, control 6px, card 12px, pill actions. Character outline shapes remain original artwork.

## Components

`button(label, route, {secondary})`: one dark primary action and an understated text secondary action. Concrete sample exploration is the current main action.

`character(kind, {className})`: original Plan (`support` SVG key), Slides, Worksheet (`activity` key), Answers. Passive wrappers are hidden from assistive technology; surrounding meaningful links carry names. Hover and keyboard focus trigger signature gestures when interactive.

`pageHero({eyebrow,title,description,character,actions})`: one H1, brief explanation, optional relevant character. No mandatory character on text-heavy or form pages.

`split({eyebrow,title,body,visual,reverse,tone})`: one idea with material proof. Alternate direction for reading rhythm; keep images tied to the claim.

`cta({title,body,actions})`: warm closing section with one Answers character. Actions can be overridden to avoid self-links.

Other system parts: mobile disclosure navigation, FAQ details, preview forms, lesson tabs, slide controls, worksheet printing, reading-column pages and policy-status notices.

## Blocks and composition

1. Home hero and original four-material team.
2. One connected-material preview: Year 3 shadows, Year 7 particles and Year 9 conservation of mass. Shared canonical excerpts supply the slide, worksheet questions, disclosed answers and full-lesson link.
3. A compact preparation summary: bring a brief, review the material, adapt it for the class.
4. Closing invitation.

The homepage consolidates the former review, brief, adaptation and output split sections. The full how-it-works and feature pages retain their detailed examples. The sample switcher progressively enhances full-lesson links; without JavaScript the Year 3 preview remains available and the other choices navigate to their complete lessons.

Feature pages reuse the structure but show material-specific evidence. Information pages use reading layouts rather than forcing every topic into the same feature composition. The examples explorer is a product-like block with stable tab semantics and separate pupil/teacher print targets.

## Motion

The original cast rig supplies independent ambient behaviours and one signature per character. Marketing adds a quiet body-life layer; signatures soften it. Offscreen actors stop. The how-it-works embed reuses the final loading sequence, including the refined handoffs. User pause persists through scrolling; reduced-motion preferences suppress animation. One full team is enough per page; isolated characters accompany specific material context.

The approved loading settings remain intensity165%, breathing120%, sway125%, tempo1.25×. Marketing uses a quieter layer, keeping reading and calls to action dominant.
