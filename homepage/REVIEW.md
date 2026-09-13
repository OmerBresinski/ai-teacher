# Homepage review record

## Launch cut — 13 September 2026 (TEACH-307)

The site was rebuilt for the MVP launch: eleven routes, DayBack throughout, one end-to-end flow,
real policy pages and example lessons generated from an asset manifest. The earlier record
described a different site and has been removed with the routes it described.

### What changed

- 28 routes cut to 11. The feature pages, guides, for-schools, pricing, the access list, contact,
  service providers, the design-system page and the embedded lesson animation are deleted from
  `src/` and the build, not hidden. `check.mjs` asserts the exact route set and fails on any
  reference to a removed route.
- One brand. No string from either former brand survives in the source or the output, and every
  page title is branded DayBack with no duplicated suffix.
- No work-in-progress language. The footer note, the hero status line, the `noscript` notice and
  the two forms that sent nothing are gone, with the two scripts that drove them.
  `check.mjs` fails the build on any of the banned phrases in `dist/` or in the source.
- The hero box is a real `GET` form to `${appUrl}/lessons/new`, with an upload link to `?source=1`
  and a CSS-only tooltip. It works with JavaScript disabled.
- Example lessons are exported images read from `assets/examples/<slug>/manifest.json`.
- Privacy, terms and cookie notices are real notices with named processors, transfers, retention
  and rights. The placeholder company facts they carry are listed in the launch checklist.

### Verified for this change

- `bun run homepage:check`: 11 routes, one H1 per page, no duplicate IDs, no broken links, anchors
  or assets, no forbidden brand or work-in-progress string, every title branded.
- `bun run homepage:lint`: clean apart from the inherited CSS specificity and `!important`
  warnings the imported stylesheets have always reported.
- Every route loaded at 1440 and 390 in Chromium: zero page errors and zero console errors, and
  `document.documentElement.scrollWidth` is 390 at a 390 viewport. The `Cannot read properties of
  null (reading 'addEventListener')` error on `/` came from the deleted `examples.js`, which called
  `root.querySelector(".ex-slide-viewer")` when `root` was itself the slide viewer; the file is
  deleted with the markup it drove.
- `apps/web/e2e/homepage-launch.spec.ts`: hero form submits the encoded topic to the application
  with JavaScript on and off, an empty field does not navigate, the upload link points at
  `?source=1`, navigation links resolve, an example page renders images with real alt text, 390
  does not overflow, no route logs a page error, and axe reports no serious or critical violations
  on home, an example lesson, the FAQ and the privacy notice.
- Light-theme full-page screenshots of all eleven routes at 1440 and 390.

Automated checks supplement visual and keyboard review; they are not a claim of complete
accessibility certification. The site does not certify curriculum alignment.
