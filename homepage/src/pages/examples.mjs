import { cta, escapeHtml, href, nextIcon, pageHero, textLink } from "../components.mjs";
import { assetHref, examples } from "../examples-data.mjs";
import { lessonGrid, materials, yearSubject } from "../lesson-card.mjs";

const image = (slug, item, extra = "") =>
  `<img src="${href(assetHref(slug, item.src))}" alt="${escapeHtml(item.alt)}" ${extra}>`;

// Every list of materials is read from the manifests: a lesson may ship with slides only.
const anyWorksheet = examples.some((example) => example.worksheet);

const indexPage = {
  route: "/examples/",
  title: "Top lessons | DayBack",
  description: anyWorksheet
    ? "Whole lessons to open and read: every slide, the worksheet and the answer key."
    : "Whole lessons to open and read, slide by slide.",
  body:
    pageHero({
      title: "Top lessons.",
      description: anyWorksheet
        ? "Open a lesson to see every slide, the worksheet and the answer key."
        : "Open a lesson to see every slide.",
    }) +
    (examples.length
      ? `<section class="section" aria-label="Top lessons"><div class="container">${lessonGrid(examples, { level: 2 })}</div></section>`
      : "") +
    cta(),
};

// Slides: with JavaScript, one large stage slide and a strip of thumbnails; without it, every
// slide stays visible in a grid. The thumbnail controls are hidden until the script takes over.
const slideViewer = (example) => {
  const total = example.slides.length;
  return `<div class="viewer" data-viewer>
    <ol class="viewer-slides" role="list">${example.slides
      .map(
        (slide, index) =>
          `<li class="viewer-slide${index === 0 ? " is-current" : ""}">${image(example.slug, slide, `width="1440" height="810"${index > 0 ? ' loading="lazy"' : ""}`)}</li>`,
      )
      .join("")}</ol>
    <div class="viewer-controls" hidden>
      <p class="viewer-status" aria-live="polite">Slide 1 of ${total}</p>
      <div class="viewer-steps">
        <button type="button" class="viewer-step" data-step="-1" aria-label="Previous slide"><span aria-hidden="true" class="viewer-flip">${nextIcon}</span></button>
        <button type="button" class="viewer-step" data-step="1" aria-label="Next slide"><span aria-hidden="true">${nextIcon}</span></button>
      </div>
      <div class="viewer-thumbs" role="group" aria-label="Choose a slide" style="--count: ${example.slides.length}">${example.slides
        .map(
          (slide, index) =>
            `<button type="button" class="viewer-thumb" data-index="${index}" aria-label="Slide ${index + 1} of ${total}" aria-pressed="${index === 0}"${index === 0 ? ' aria-current="true"' : ""}><img src="${href(assetHref(example.slug, slide.src))}" alt="" width="1440" height="810" loading="lazy"></button>`,
        )
        .join("")}</div>
    </div>
  </div>`;
};

const paperPages = (example, pages) =>
  pages
    .map(
      (page) =>
        `<figure class="paper-page">${image(example.slug, page, 'loading="lazy"')}</figure>`,
    )
    .join("");

const worksheetSection = (example) => {
  const { worksheet } = example;
  if (!worksheet) return "";
  const hasAnswers = worksheet.answers.length > 0;
  return `<section class="section section-ruled" aria-label="Worksheet${hasAnswers ? " and answer key" : ""}"><div class="container lesson-papers">
    <div class="lesson-paper-col">
      <h2 class="lesson-subhead">Worksheet</h2>
      ${paperPages(example, worksheet.pages)}
    </div>
    ${
      hasAnswers
        ? `<div class="lesson-paper-col">
      <h2 class="lesson-subhead">Answer key</h2>
      <details class="lesson-answers">
        <summary><span class="lesson-answers-show">Show the answer key</span><span class="lesson-answers-hide">Hide the answer key</span></summary>
        ${paperPages(example, worksheet.answers)}
      </details>
    </div>`
        : ""
    }
  </div></section>`;
};

const lessonPage = (example) => ({
  route: `/examples/${example.slug}/`,
  title: `${example.title} | ${yearSubject(example).replace(" · ", " ")} | DayBack`,
  description: `${example.title}: a ${example.year} ${example.subject} lesson with ${example.slides.length} slides${example.worksheet ? `, a worksheet${example.worksheet.answers.length ? " and an answer key" : ""}` : ""}.`,
  scripts: ["/assets/lesson-viewer.js"],
  body: `<section class="page-hero container lesson-head">
      <a class="text-link lesson-back" href="${href("/examples/")}"><span aria-hidden="true">${nextIcon}</span>Top lessons</a>
      <p class="eyebrow">${yearSubject(example)}</p>
      <h1>${escapeHtml(example.title)}</h1>
      <p class="lesson-materials">${materials(example)}</p>
    </section>
    <section class="section" aria-labelledby="slides-heading"><div class="container">
      <h2 class="lesson-subhead" id="slides-heading">Slides</h2>
      ${slideViewer(example)}
    </div></section>
    ${worksheetSection(example)}
    ${cta({ secondary: textLink("All top lessons", "/examples/") })}`,
});

export default [indexPage, ...examples.map(lessonPage)];
