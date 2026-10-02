# How Chalkie fits lessons to slides

30 Sept 2026. Read-only research: no paid model calls, no sign-in, no new Chalkie generations.
Question from Greg: how does Chalkie get a lesson onto the requested number of slides with no overflow and no "continued" pages?

**Short answer.** Chalkie doesn't fit text after the fact. It has no autofit, no font shrink and no splitting. Every deck has the same 10-slide skeleton. Each slide is one of a small set of fixed component layouts, drawn with a fixed type scale on an 800×450 design canvas. The text in each slot is short enough to fit the slot, which points to caps set when the text is generated. Text boxes are sized to the measured text, and the renderer places the next block below them. When a text runs long, it overlaps or covers something (the wordmark, the next answer row). The slide never grows or splits. Chalkie is **not** sparse: it puts more words on each slide than we do.

Evidence base:
- **E1.** The seven Chalkie decks from the 15 Sept audit, held in the lab notes and not in the repo (they are Chalkie content): for each deck the PDF, page images, the generation settings and the extracted text. The PDFs were made by LibreOffice Impress, so each is a PPTX converted to PDF.
- **E2.** One native Chalkie PPTX, "The World of Rodents" (27 Sept, 12 slides; a local download, not in the repo). Its image paths read `chalkie-production-workers-2/releases/78652158/backend/storage/app/render-specs/<uuid>/…`, which shows it is a Chalkie export. It is the only native PPTX we hold, so every bodyPr and font-size observation below comes from it. The XML was read from an unzipped local copy.
- **E3.** The Chalkie wizard screenshots and the report from the homepage study (lab notes, not in the repo), report §3.
- **E4.** Greg's stopwatch timings, recorded in each deck's settings notes.
- **E5.** Our audit scores: the 15 Sept quality-vs-Chalkie audit ("the audit" below) §2.1 and §2.2, and runs E15 and E33 of the lab eval registry (both lab notes, not in the repo).

---

## 1. Observed

### 1.1 Autofit and bodyPr (E2, all 12 slides)
- **There is no autofit anywhere in the deck.** No shape in any slide, the layout or the master has `normAutofit`, `spAutoFit`, `fontScale` or `lnSpcReduction`; a grep over `ppt/` finds none. Every text box is `<a:bodyPr wrap="square" anchor="t|ctr" …>` with no children, so PowerPoint neither shrinks the text nor grows the box.
- **Line spacing is exact.** Body paragraphs have `<a:lnSpc><a:spcPts val="2160"/>` (21.6 pt, which is 1.2 × 18 pt) and 3.6 pt spacing before and after (slide 4 `EXynBoY3`). Because the pitch is fixed, the height of a block can be computed from its line count.
- **The fonts are embedded** (`ppt/fonts/font1–5.fntdata`: Comic Neue, Livvic and others). The PDFs embed theirs too, for example Dyslexie, Karla, Inter and Twemoji in Y4 (`pdffonts`). A wrap measured when the deck is built therefore matches what the teacher sees.

### 1.2 Font sizes are fixed per role and don't vary with text length
- **The type scale is the same on every slide (E2):** cover title 32.4 pt; slide title 28.8; body 18.0; card heading 19.8; callout label 16.2; subtitle and instruction 16.2; number badge 21.6; true/false button 23.4; audio button 14.4. Every one of these is a round pixel size × 0.9 (36, 32, 20, 22, 18, 24, 26, 16 px). On a 720 pt slide that means an **800 px wide design canvas**, converted at 0.9 pt per px. (That the canvas is 800 px is inferred from the ratio.)
- **The body size stays the same however long the text is (E1).** Glyph-box heights from `pdftotext -bbox` stay constant within each deck. In Y11 rates the modal height is 22 on every page, including p4 with 110 words and p1 with 11. The same holds for Y10 Tempest (22 throughout).
- **The size changes with the year group or theme, not with length.** Y1 animals has a modal height of 29 on every page, against 22 at Y10 and Y11. That is a larger body size for younger pupils (or for that theme), fixed for the whole deck.

### 1.3 Layouts: one blank master and absolutely placed components
- **E2 has a single `slideLayout1` named "DEFAULT" with an empty spTree.** Every element is an absolutely positioned `p:sp` or `p:pic`. There are no placeholders. Every slide has a full-bleed theme background (`Slide-N-image-1.jpeg`, 2328×1310). The notes slides hold only the slide number.
- **We counted about seven component layouts in E2** (geometry summarised here):
  - cover: image on the left, title and subtitle on the right;
  - hook or content: text on the left (x22, w405), photo bleeding off the right (x446, w274, full height);
  - content: photo on the left (w302 h320), text on the right (w360), callout below;
  - two cards: two images of w330 above two text cards of w330;
  - three cards: three images of w213, the middle one raised, above three text cards;
  - banner: an image strip across the top (h144), then title, body and callout;
  - question list: four numbered rows at a fixed pitch (y211, 251, 290, 330; 40 pt apart; each box h31);
  - true or false: a statement card, two buttons, and an answer-reveal twin.
- **The same components appear in every E1 deck.** The four-option card stack, the numbered audio-question list, the key-point callout, two-column cards and the "You might have said…" twin all recur across all seven decks with the same geometry. For example, the option cards on Y1 p12 and Y11 p9 have identical positions.
- **Heights are measured; positions are fixed.** Titles are always y14 h51. Callouts are a constant h97 and sit near the bottom (y251 to y288). Body boxes vary in height, with h79, 175, 179, 206 and 132 on slides 2, 3, 4, 6 and 7, and those heights match whole numbers of 21.6 pt lines plus insets. For example, slide 2 has 24 words, 3 lines, and 3×21.6 + 14.4 = 79.2. So each box is as tall as its measured text, and the element below it is placed on a fixed slot or directly under it.

### 1.4 Slide count
- **The wizard defaults to "10 slides"** as a chip beside year, reading level and English variant (E3). All seven audit decks were generated at the default (the settings notes record "slide count" default).
- **Every deck has exactly 10 base slides once the answer twins are excluded:**

| Deck | Pages | Answer or reveal twins | Base slides |
|---|---|---|---|
| Y1 animals | 13 | p7, p11, p13 | 10 |
| Y4 Romans | 12 | p8, p12 | 10 |
| Y5 fractions | 11 | p11 | 10 |
| Y8 rivers | 12 | p10, p12 | 10 |
| Y10 Tempest | 12 | p10, p12 | 10 |
| Y11 rates | 11 | p10 | 10 |
| Y13 Freud | 11 | p10 | 10 |
| Rodents (E2) | 12 | s10, s12 | 10 |

- **The skeleton is the same in all eight decks:** 1 title, 2 hook ("Imagine…", "Crack!…", a question), 3 learning objectives, then five or six content slides, one or two practice items (an option stack, a true-or-false, an audio quiz or a "debate" prompt), and a final check or debate. Each practice item has a reveal twin. None of the eight decks has a "continued" slide.

### 1.5 Words per slide: Chalkie is denser than us
`pdftotext` words per page, same seven briefs (E1 against our 15 Sept production decks for the same briefs):

| Brief | Chalkie mean / median / max | DayBack mean / median / max |
|---|---|---|
| Y1 animals | 32 / 27 / 57 | 27 / 26 / 48 |
| Y4 Romans | 46 / 46 / 74 | 38 / 36 / 53 |
| Y5 fractions | 40 / 37 / 64 | 34 / 33 / 54 |
| Y8 rivers | 49 / 57 / 70 | 37 / 41 / 60 |
| Y10 Tempest | 54 / 49 / 81 | 35 / 40 / 55 |
| Y11 rates | 54 / 46 / 104 | 33 / 34 / 46 |
| Y13 Freud | 43 / 45 / 57 | 39 / 42 / 55 |
| **All seven** | **≈46** | **≈35** |

- The Chalkie counts include the answer twins, which repeat the question, and the "CHALKIE" wordmark. Leaving the twins out moves the mean only slightly, because content slides run 40 to 60 words.
- E2 Rodents has 541 words over 12 slides; its content slides carry 47 to 62 words each.
- **What Chalkie holds constant is the length of each element, not the words per slide.** In E2, the body paragraphs run 24 to 42 words, callouts 11 to 18 words (a label plus one sentence), card texts 13 to 16 words (a heading plus one sentence), question rows 7 to 12 words and answer rows 10 to 12 words. Titles are 3 to 6 words.

### 1.6 Overflow and clipping that got through
Chalkie has no fallback when text runs long: the text simply collides with something.
- **The fourth option card covers the CHALKIE wordmark** on Y11 p9 and Y1 p12 (both inspected). The audit's §2.3 slide tables log the same fault on three answer-twin slides ("wordmark clipped behind option 4"). The card stack is a fixed slot and the wordmark is a fixed theme element; nothing checks whether they collide.
- **Y10 p10: two-line answers in one-line rows.** The numbered answer rows sit at a fixed pitch (E2 shows 40 pt apart with h31 boxes). Four answers of 12 to 17 words each wrap to two lines and run into the next row's badge, so the rows touch and the list crowds down onto the decorative fish.
- Other Chalkie defects in the audit (§6 row "Chalkie's own defects"): a cloud graphic covering a slide, a white-on-white model answer, and in Y8 p5 a clipped caption on a scraped video thumbnail.
- In every deck we inspected, the text stays inside the slide. No text is cut off at the slide edge. The collisions happen inside the slide.

### 1.7 Timings (E4)
First slide appeared at 3 to 6 s every time. The deck became editable at 22 s (Y11: new account, no audio), 35 s (Y5, audio off), 40 s (Y8), 52 s (Y10), 59 s (Y1) and 63 s (Y4). For Y4, Greg noted that "the voice activity alone held the last 20 to 30 s". Slides stream in while the toast "Performing magic…" shows (E3, report §3 item 3).

---

## 2. Inferred

These points are interpretation. Confidence is marked on each.

1. **They lay the slide out in a browser first, then serialise it to PPTX (high).** Evidence: the `render-specs/<uuid>/` path, px sizes × 0.9, text boxes as tall as their measured text, embedded web fonts, and a single "DEFAULT" layout with absolute shapes. That last one is the PptxGenJS signature (medium: the `DEFAULT` layout name and the `Slide-N-image-M` media naming match PptxGenJS; the `backend/storage/app` path looks like a Laravel backend). The browser measures the text and the PPTX copies the measured geometry. No PowerPoint autofit is needed.
2. **The text fits because its length is set when it is written (medium-high).** Each content type has a fixed shape: a paragraph, a one-sentence callout, three or four short card texts, or four one-line options. The steady per-element lengths suggest limits written into the schema or prompt ("one sentence", "max N words", a fixed number of cards). That would explain why nothing ever needs splitting. It would also explain the failures: when a model goes over (as with the Y10 answers), the slot doesn't grow and nothing repairs it.
3. **The slide count is fixed because the skeleton is a template (high).** It was 10 on all eight decks, with the same order of title, hook, objectives, content, practice and check. The planner fills N slots of known types and never decides to add one. The answer twins are generated by the renderer from a question slide, so they don't count toward N.
4. **The pipeline order is outline, then slides in parallel or streamed, then audio last (medium).** The first slide at 3 to 6 s is too fast for a whole-lesson plan with a strong model. That points to a small, quick call (title plus outline, or the title slide straight from a template) followed by per-slide calls streamed into the fixed components. The spread of editable times (22 to 63 s) follows the optional audio step: runs without audio finished in 22 to 35 s, runs with audio in 40 to 63 s, and Greg saw audio hold the last 20 to 30 s. So the text for 10 slides takes roughly 20 to 35 s, and that doesn't need a verify or repair pass. We don't see one in the output: the collisions in §1.6 would have been caught.
5. **They do no geometry check after rendering (medium).** The same wordmark collision in several decks, and the unsized answer rows, suggest nothing measures the finished slide against the theme's fixed elements.
6. **The body size scales with age through the theme or year band (medium).** Y1 is about 30% larger. This is a deck-level choice made before any text is written, not a way of fitting.

---

## 3. What this costs them in teaching quality (E5)

The fitting approach and the audit scores point the same way:
- **Depth is capped by the slot.** One paragraph plus one callout per slide, facts stated but not built up (audit §3, depth). Third-party reviewers say the same: "Depth per slide is capped by design" and "needed manual expansion on nearly every explanatory slide" (aitoolsbakery review). Chalkie's depth scored 2 to 4 (mean 2.9), and it had no worked examples outside maths.
- **Practice is squeezed by the fixed skeleton.** The template allows one or two practice items and one final check, however many objectives there are. Chalkie scored 2.5 on questionQuality (J1). In the later judging it scored 1.14 on practice and 1.29 on flow (E33), against our 3.14 and 3.14. Only 6 of 17 objectives were met (J1). A 10-slot template can't give three objectives an explain, practice and check each.
- **The template carries the coherence score.** Chalkie's coherence was good (3 to 4, with Y10 at 4 even though everything else there was 2). The fixed title, hook, objectives, content and check order always reads like a lesson.
- **Pitch drifts under fixed slots.** The slots have to be filled at every year group, so at KS4 the slots fill with dense register ("molecular stoichiometry", "colonial hegemony"; Y10 pitch 2).
- Overall, Chalkie averaged 2.9 on J1 (ours 3.1) and 2.41 on J5 at E15. Our lab arms beat it 7–0 pairwise (E23 to E25) and 6–0–1 at E33. Its fit is dependable and its lessons are thin. Its look ("clean enough to project straight away") is what reviewers praise.

---

## 4. What we could adopt, within Greg's rules

Greg's rules are: no word limits in prompts, no summarising after the fact, no extra slides.

| Chalkie mechanism | Adopt? | How it fits our rules |
|---|---|---|
| Browser-measured layout with a fixed line pitch and embedded fonts, so the measured wrap is the shipped wrap | **Yes** | This is pure rendering. Measure once at generation time with the real font, set boxes to their measured height, and use exact line spacing in the PPTX export. It removes the gap between the renderer's wrap and PowerPoint's wrap. |
| Fixed type scale per role, set per deck by year band or theme, never shrunk to fit | **Yes** | It needs no prompt change. Fitting then becomes a question of how much content goes on the slide, which is where fit-first generation already puts it. |
| A small set of named components, each with a known capacity at that type scale (paragraph block, callout, 2 or 3 cards, a 4-row list, an option stack) | **Yes, as capacities the planner knows, not as word caps in prompts** | The designer and planner chooses a component whose measured capacity fits what the slide has to teach. That is "plan content per slide to fit" (fit-first) and "palette-aware designer", with the numbers coming from measurement, not a prompt limit. |
| Rows and cards that grow to their text, then a reflow of the elements below | **Yes, do it better than Chalkie** | Their fixed-pitch rows collide (Y10 p10). Ours should stack by measured height. That is layout, not summarising. |
| A final collision check against fixed theme furniture (wordmark, decorations) | **Yes** | Chalkie misses this (the wordmark sits under option 4). A cheap geometry assertion at render time, with no model involved. |
| A reveal twin rendered from the question slide and not counted in N | **Already close** | Our reveal steps do the same job inside one slide, so there's no page cost. |
| A fixed 10-slot skeleton | **No** | It conflicts with "lesson structure flexible" (26 Sep) and it is the cause of Chalkie's weak practice and objectives scores. Keep the count fixed and let the order and types vary. |
| Per-element length set when the text is written (implied caps) | **No, not as prompt limits** | Greg's rule. The same effect comes from the planner choosing components whose measured capacity matches the content (above), not from telling the writer "max N words". |
| Splitting or "continued" slides | Chalkie doesn't do it either | This confirms that splits should stay a last resort and be rare. Chalkie reaches zero only by never letting content exceed a slot. It gets there through the plan, not the renderer. |

**Bottom line for us.** The part of Chalkie worth copying is how it renders: a measured layout, a fixed type scale, components with known capacity, and embedded fonts. The part that makes its text fit (a fixed skeleton and short slots) is also what makes its lessons thin, and we shouldn't copy it. Their mean of about 46 words per slide shows the slide itself can hold more than we currently put on it, once the layout is measured rather than guessed.

---

## 5. Public material
Fetched 30 Sept 2026. **Chalkie publishes nothing about how it fits text:** no help-centre page, blog post or changelog entry mentions overflow, autofit, font scaling or words per slide.

- **Slide count is a setting with a per-plan ceiling.** Pricing: Pro "Lessons up to 25 slides", Max "Lessons up to 35 slides" and "Custom themes and fonts" (https://chalkie.ai/en/pricing). The FAQ repeats "up to 35" for Max (https://chalkie.ai/en/faqs). The wizard default is 10 (E3). We have observed only 10-slide decks, so how the skeleton scales to 25 or 35 slides is **not observed**.
- **The structure is described as fixed.** A generated lesson has a "title slide, objectives, content slides, vocabulary, activities, and imagery" (https://chalkie.ai/en/blog/ai-lesson-plan-generator-slides). That matches the skeleton in §1.4.
- **Speed claim:** "in under 30 seconds, Chalkie produces a fully structured lesson slideshow" (same blog post). The claim matches Greg's no-audio runs (22 s, 35 s), not the runs with audio.
- **Editing is where overflow gets fixed.** The AI Slide Editor takes "plain English instructions", for example "Make this simpler" or "Add a slide on…" (same post; https://chalkie.ai/en/uses/ai-powerpoint-generator-teachers). Pricing meters it: 10 AI edits a week on Free, 400 or 800 a month on paid plans. Inferred: when a slide is too long, the teacher has to fix it, and the product doesn't.
- **Themes and export:** "30+ built-in presentation themes"; exports "natively to PowerPoint, Google Slides, or PDF in one click" (ai-powerpoint-generator-teachers page). Reviewers: "Depth per slide is capped by design" and an AP deck "needed manual expansion on nearly every explanatory slide" (https://aitoolsbakery.com/blog/chalkie-review/).
- **Company context** (a Chalkie job ad, "Founding Product Designer"): a team of 10 at £6m ARR, the design function led by a designer CPO, and "Living in Claude and Cursor". The ad says nothing about their generation stack.

## 6. Limits of this evidence
- There is one native PPTX (Rodents, 27 Sept). The seven audit decks are PDFs converted from PPTX, so their font sizes are inferred from glyph-box heights, not read from the XML.
- Every deck is at the default of 10 slides. Behaviour at 15, 25 or 35 slides is unknown.
- Nothing here shows Chalkie's prompts. The "implied caps" in §2.2 are inferred from how steady the per-element lengths are.
