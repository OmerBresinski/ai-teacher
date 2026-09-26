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
    ? "Whole lessons to open and read: every slide, the worksheet and the answers."
    : "Whole lessons to open and read, slide by slide.",
  body:
    pageHero({
      title: "Top lessons.",
      description: anyWorksheet
        ? "Open a lesson to see every slide, the worksheet and the answers."
        : "Open a lesson to see every slide.",
    }) +
    (examples.length
      ? `<section class="section" aria-label="Top lessons"><div class="container">${lessonGrid(examples, { level: 2 })}</div></section>`
      : "") +
    cta(),
};

// The answers switch: hidden until the script runs, so it never shows without something to do.
const answerSwitch = (label, extra = "") =>
  `<button type="button" class="answer-toggle" role="switch" aria-checked="false" hidden ${extra}><span aria-hidden="true"></span>${label}</button>`;

// Slides: with JavaScript, one large stage slide with every control in one row under it (where the
// slide is, the counter, the answers switch, previous and next) and a strip of thumbnails; without
// it, every slide stays visible in a grid.
const slideViewer = (example) => {
  const total = example.slides.length;
  return `<div class="viewer" data-viewer>
    <ol class="viewer-slides" role="list">${example.slides
      .map(
        (slide, index) =>
          `<li class="viewer-slide${index === 0 ? " is-current" : ""}"${slide.answer ? " data-has-answer" : ""}>${image(example.slug, slide, `width="1440" height="810"${index > 0 ? ' loading="lazy"' : ""}`)}${slide.answer ? image(example.slug, slide.answer, 'width="1440" height="810" loading="lazy" hidden data-answer') : ""}</li>`,
      )
      .join("")}</ol>
    <div class="viewer-controls" hidden>
      <p class="viewer-status" aria-live="polite">Slide 1 of ${total}</p>
      <div class="viewer-actions">
        ${answerSwitch("Answers", "data-slide-answers")}
        <button type="button" class="viewer-step" data-step="-1" aria-label="Previous slide"><span aria-hidden="true" class="viewer-flip">${nextIcon}</span></button>
        <button type="button" class="viewer-step" data-step="1" aria-label="Next slide"><span aria-hidden="true">${nextIcon}</span></button>
      </div>
      <div class="viewer-thumbs" role="group" aria-label="Choose a slide" style="--count: ${total}">${example.slides
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

// One printed document: the pupil sheet, and its answers behind a switch in the same place.
// Without JavaScript the answers simply follow the sheet.
const paperDoc = (example, title, doc, answersLabel) => {
  const hasAnswers = doc.answers.length > 0;
  return `<article class="paper-doc" data-paper>
    <div class="paper-bar"><h2 class="paper-title">${title}</h2>${hasAnswers ? answerSwitch(answersLabel) : ""}</div>
    <div class="paper-sheet">${paperPages(example, doc.pages)}</div>
    ${hasAnswers ? `<div class="paper-answers" data-answers><p class="paper-answers-label">${answersLabel}</p>${paperPages(example, doc.answers)}</div>` : ""}
  </article>`;
};

const papersSection = (example) => {
  const docs = [
    example.worksheet ? paperDoc(example, "Worksheet", example.worksheet, "Mark scheme") : "",
    example.exitTicket ? paperDoc(example, "Exit ticket", example.exitTicket, "Answers") : "",
  ].join("");
  return docs
    ? `<section class="container lesson-block" aria-label="Printable sheets"><div class="lesson-papers">${docs}</div></section>`
    : "";
};

const lessonPage = (example) => ({
  route: `/examples/${example.slug}/`,
  title: `${example.title} | ${yearSubject(example).replace(" · ", " ")} | DayBack`,
  description: `${example.title}: a ${example.year} ${example.subject} lesson with ${example.slides.length} slides${example.worksheet ? ", a worksheet" : ""}${example.exitTicket ? ", an exit ticket" : ""} and the answers.`,
  scripts: ["/assets/lesson-viewer.js"],
  body: `<section class="container lesson-head">
      <a class="text-link lesson-back" href="${href("/examples/")}"><span aria-hidden="true">${nextIcon}</span>Top lessons</a>
      <div class="lesson-title-row">
        <div><p class="eyebrow">${yearSubject(example)}</p><h1>${escapeHtml(example.title)}</h1></div>
        <p class="lesson-materials">${materials(example)}</p>
      </div>
    </section>
    <section class="container lesson-block" aria-label="Slides">${slideViewer(example)}</section>
    ${papersSection(example)}
    ${cta({ secondary: textLink("All top lessons", "/examples/") })}`,
});

export default [indexPage, ...examples.map(lessonPage)];
