# Curriculum statements (England)

The statutory National Curriculum in England, key stages 1 to 4, one row per statement, verbatim.
The objectives step reads it through `curriculumFor` (HEART1 plan F): the writer objectives call
gets the year's statements for the lesson's subject as its `{{curriculum}}` block.

## Source and licence

- Publisher: Department for Education, "National curriculum in England: <subject> programmes of
  study", the HTML publications under
  https://www.gov.uk/government/collections/national-curriculum (one per subject; the exact URL
  and its last-updated date are in each file's `_provenance`).
- Retrieved 10 October 2026 through the GOV.UK Content API (`/api/content/<publication path>`).
- Licence: [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
  Attribution: **Contains public sector information licensed under the Open Government Licence
  v3.0.**

## What is stored

Only the statutory requirements: the "Pupils should be taught" lists of each programme of study,
for art and design, citizenship, computing, design and technology, English, geography, history,
languages, mathematics, music, physical education and science (1,380 statements).

Not stored: the "Notes and guidance (non-statutory)" boxes, purpose of study, aims, attainment
targets, the introductory paragraphs of each key stage, the KS4 science "key ideas" lists, the
English and mathematics appendices (spelling, vocabulary and grammar, and the mathematics
appendix), and the KS4 maths note on typographic conventions. Religious education, relationships
and sex education and PSHE are not national curriculum programmes of study and have no data.

## Shape

`england/<subject>.json` is `{ _provenance, statements }`. Each statement:

| field | meaning |
| ----- | ------- |
| `id` | stable, derived: `england.<subject>.<y6 or y3-4>.<heading slugs>.<n>`, `n` counting from 1 within its heading |
| `country` | `"england"` |
| `subject`, `keyStage` | e.g. `"science"`, `"KS2"` (`"KS1-2"` for English spoken language, years 1 to 6) |
| `years`, `yearBand` | first and last year taught, and the source heading they come from |
| `domain`, `headings` | the nearest domain/topic heading, and the full heading path, verbatim |
| `text` | the statement, verbatim (whitespace collapsed) |
| `parentId` | set on a sub-point of a nested list |

Headings are kept as the source writes them, including its inconsistencies: Year 6 science reads
"Animals including humans" where other years read "Animals, including humans".

`index.ts` holds the zod schema, the typed loader (`CURRICULUM`) and the lookup:

```ts
curriculumFor({ country, subject, yearGroup, topic }): {
  subject?, year?, statements, matchedDomains
}
curriculumBlock(lookup, yearGroup): string // the {{curriculum}} block, "" when there is no data
```

`curriculumFor` returns every statement for that year and subject (code does not narrow to the
topic; the model picks the unit). With a topic, the domains whose heading shares a keyword come
first, then those whose statements do; the rest keep source order. It is a keyword match, with no
model call. `curriculum.test.ts` validates every row and pins the counts per subject and key
stage, so a rebuild that changes the data shows up there.

## Rebuilding

The rows were extracted from the HTML body of each publication: list items in document order,
headed by the nearest `h2` (the year band) to `h4` (the domain), skipping everything inside the
`call-to-action` boxes that hold the non-statutory notes. Rebuild the same way and compare counts
with the test before replacing a file.
