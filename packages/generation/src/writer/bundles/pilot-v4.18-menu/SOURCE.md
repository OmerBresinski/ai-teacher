Pilot writer pack v4.18 (layout-selection, 27 Oct 2026). Built on v4.17 (PR #706); v4.16 and v4.17 stay frozen (hash tests). Lab pack: production still runs v4.17 until its own PR from master.

From a $0 audit of 16 recorded lessons (layout-selection notes.md): visual-text took 43 of 69 teaching slides, mostly because the plan gave each member of a group its own "one big idea" slide; a caption-first rule and figure-slide's "carries its idea alone" produced duplicate words + map pairs; check slides were 55% of the lesson.

system-KS*.template.txt = the v4.17 templates with:
- Flow: each entry names its `group` after `does` (schema field too, `flowGroup`); the reasons-only unit rule becomes one rule for every group kind (reasons, parts, ways or methods, kinds or structures).
- Layout step: take the layout the Routes table gives; the caption-first rule holds for big-visual only.
- A Routes table (shape x what pupils look at), from layout-selection routes.py SHAPE_ROUTES. Code ask: generate it from a TS constant with a parity test.
- Lesson structure: learning cycles (UX ruling 297, Greg 27 Oct), one block in place of "plan at least one hinge"; the worked-example try-one is its cycle's check.
Code-built menu lines (V418_MENU_EDITS in pilot-pack.ts): routing clauses the table carries are deleted; figure-slide states its facts in up to 2 lines; items-row offers a picture per part; practice is one slide.
Not built yet (slide side): figure-slide's 2 lines and items-row's per-part pictures in the schema and renderer.
