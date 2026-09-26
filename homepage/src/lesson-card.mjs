import { escapeHtml, href } from "./components.mjs";
import { assetHref } from "./examples-data.mjs";

// "Year 4 · Science": the manifest stores the subject in lower case for use inside sentences.
export const yearSubject = (example) =>
  `${example.year} · ${example.subject[0].toUpperCase()}${example.subject.slice(1)}`;

// What a lesson ships with, read from its manifest: never promise a worksheet that is not there.
export const materials = (example) =>
  [
    `${example.slides.length} slide${example.slides.length === 1 ? "" : "s"}`,
    ...(example.worksheet ? ["worksheet"] : []),
    ...(example.worksheet?.answers.length ? ["answer key"] : []),
  ].join(" · ");

// One card is one link: the cover, the year and subject, the title and the materials all sit
// inside it, so a keyboard or screen-reader user meets each lesson once.
export function lessonCard(example, { level = 3 } = {}) {
  return `<li class="lesson-card"><a href="${href(`/examples/${example.slug}/`)}">
    <span class="lesson-card-cover"><img src="${href(assetHref(example.slug, example.slides[0].src))}" alt="" width="1440" height="810" loading="lazy"></span>
    <span class="lesson-card-meta">${yearSubject(example)}</span>
    <h${level} class="lesson-card-title">${escapeHtml(example.title)}</h${level}>
    <span class="lesson-card-materials">${materials(example)}</span>
  </a></li>`;
}

// The grid only lays cards out; the page that calls it owns the section and container around it.
// Card titles are H3 under a section H2; pass `{ level: 2 }` where the grid sits under the H1.
export function lessonGrid(examples, options = {}) {
  return `<ul class="lesson-grid" role="list">${examples.map((example) => lessonCard(example, options)).join("")}</ul>`;
}
