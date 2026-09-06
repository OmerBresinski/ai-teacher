# 0023 — Export pipeline: client-side exporters, SPA print routes, in-dialog capture, JSON import

- Status: Accepted
- Date: 2026-09-06
- Related PRD decisions: TD project items 3 (print and capture routes) and 4 (export leftovers), F12 (archived, built as TeachDeck export); ADRs 0004, 0005, 0021, 0022

## Context

TeachDeck exports five formats, all in the teacher's browser: PDF through browser print of the
Next.js routes `/l/[id]/print` (`?answers`, `?notes`, `?auto`, range) and `/w/[id]/print`; PPTX
with `pptxgenjs` (`lib/export/pptx.ts`, 1,135 lines, including "build slides" that expand reveal
steps into n+1 slides because pptxgenjs has no animation API); PNG at 1×–3× with
`modern-screenshot` over a capture DOM (`lib/export/png.ts`, the `/capture/[id]/[slideId]` route);
DOCX for worksheets with `docx` (`lib/export/docx.ts`, 665 lines); and JSON (`lib/export/json.ts`).
Import reads the same JSON through the schema. The export UI is a 620px dialog with per-format
options (`components/v2/export/ExportControl.tsx`), which `docs/DEFERRED.md` explains.

TD item 3 asks where print and capture live once the app is a Vite SPA: a kept Next service, SPA
routes, or a worker job. TD item 4 lists three leftovers: the PPTX `includeAnswers` default differs
from PDF and PNG, PPTX does not draw the revealed-card badge, and two-column recipes overshoot the
safe area by 1pt. The shell's Import dialog is a placeholder ("Import arrives with the editor",
`apps/web/src/routes/library.layout.tsx`).

## Decision

1. **Everything runs client-side.** No Next.js service is kept and no Railway worker job renders
   documents. Server-side rendering of PDF/PPTX is out of scope until a sharing or emailing feature
   needs a file the teacher did not ask for in the browser.
2. **Print routes are SPA routes.** `/w/$worksheetId/print` (existing stub) and a new
   `/l/$lessonId/print` (search params exactly as TeachDeck's `lib/export/pdf.ts` writes them:
   `auto=1`, `answers=1`, `notes=1`, `handout=3`, `slides=<range>`; validated with Zod in the
   route file) render `@tj/editor`'s static slide/sheet renderers in print CSS with no app chrome, under
   `authLayoutRoute`, loaded with `lazyRouteComponent`. PDF export opens the print route in a new tab
   and calls `window.print()` when `auto=1`, as TeachDeck's `lib/export/pdf.ts` does. The 3-up
   handout and the answers/notes pages keep TeachDeck's layout.
3. **Capture is in-dialog.** `/capture/[id]/[slideId]` is not ported. PNG export mounts an offscreen
   capture stage inside the export dialog (TeachDeck already captures a DOM node with
   `modern-screenshot` and waits for `data-capture-ready`), renders each slide in turn, and
   downloads files one at a time with the counter and 120 ms gap TeachDeck ships. No zip.
4. **Exporter libraries load on click.** `pptxgenjs`, `docx` and `modern-screenshot` are
   `await import()`ed inside the export action for their format; they never appear in a route chunk
   (ADR 0022 §8). The `icon` element's PPTX rasterisation keeps using the browser canvas.
5. **Phases.** E1: JSON export and import plus PDF via the print routes — no new dependencies.
   E2: PPTX (with build slides) and PNG for lessons. E3: DOCX for worksheets plus the TD item 4
   leftovers, fixed in the port rather than upstream. Each phase is its own ticket set; the export
   dialog ships in E1 with the PPTX/PNG/DOCX rows disabled until their phase lands.
6. **Import.** The import format is the domain document (ADR 0021 §7). The shell's Import dialog
   becomes real in E1: it accepts `*.teachdeck.json` and `*.worksheet.json`, runs `migrate()` then
   `parseLesson`/`parseWorksheet`, creates the document through `libraryMutations.createDocument`
   with the full body, and shows TeachDeck's error copy for a newer version or an invalid file.
   Import from the editor toolbar is not added.
7. **Filenames and options.** TeachDeck's names are kept: `${slug}.teachdeck.json`,
   `${slug}.worksheet.json`, `${slug}.pptx`, `${slug}.docx`, `${slug}-${index}.png`. The lesson
   formats that have an answers option — PDF (`answers`), PPTX (`includeAnswers`) and PNG — share
   one default (TD item 4); JSON has no options; the worksheet DOCX keeps its own
   `includeAnswerKey`, defaulting to the worksheet's `includeAnswerKey` field. The slide range
   control stays in the PNG panel as `docs/DEFERRED.md` decides.

## Consequences

- One new route in `apps/web` (`/l/$lessonId/print`; the worksheet print route already exists as a
  stub), five editor routes in total, and none anywhere else; `router.test.ts` and the a11y route
  loop gain the new one. Print pages carry no sidebar, no app bar and no toaster.
- The export dialog is the one place capture DOM is mounted; navigating away mid-run cancels the
  remaining downloads, which the dialog's "stay" behaviour prevents.
- PPTX writes theme fonts as family names (`FONT_FAMILIES` in `lib/export/pptx.ts`), so the
  eleven theme fonts must be installed on the teacher's machine for full fidelity; DOCX uses its own
  fixed face (Calibri) and is unaffected — both unchanged from TeachDeck.
- Remote images depend on CORS at capture time — unchanged; the data-URL images of the mock phase
  always work.
- Revisit when sharing needs a hosted PDF: the print route already renders headless, so a Playwright
  worker job is the natural next step, not a Next service.
