# AGENTS.md — `packages/extract` (`@tj/extract`)

Document extraction and screening for F03 Sources (ADR 0027 §2). `POST /sources` in `apps/api`
calls `sniffMime` → `extract` → `screen` inside the upload request; the result is written as
`extracted.json` (`ExtractedSourceSchema` in `@tj/domain`) for the worker's `SourceLoader`. Pure
functions over bytes: no HTTP, no storage, no database, no model calls. Read the root
[`AGENTS.md`](../../AGENTS.md) first.

## Constraints

- **Never log, throw or include document text.** `ExtractError` messages name the format and a
  cause class only (ADR 0015). Tests may assert on text; production code never emits it.
- **Server-only.** `apps/web` must not depend on this package (`bundle.test.ts` guards it).
- **Exact pins** for the four parsers (`unpdf`, `mammoth`, `jszip`, `fast-xml-parser`); they were
  spiked on Bun on 2026-09-12 and any bump is re-verified with `bun test` here.
- **No binary fixtures in git.** `src/testing/fixtures.ts` generates PDFs with `pdf-lib`, DOCX
  with `docx` and PPTX with `jszip` at test time; `@tj/extract/testing` exposes them to `apps/api`.
- The screens are deterministic (F03-D5: err toward refusal, no override). Changing a threshold or
  a pattern is a design change: amend ADR 0027 §2 in the same PR.

## Layout

```
src/
  index.ts        public surface: types, sniffMime, extract, screen, isLowText, LIMITS, ExtractError
  mime.ts         sniffMime (magic bytes + zip probe)
  screen.ts       too-long, roster, identifiers, unreadable
  formats/        pdf.ts, pptx.ts, docx.ts, paste.ts — one Extraction builder per format
  testing/        fixtures.ts (generated documents for tests)
```
