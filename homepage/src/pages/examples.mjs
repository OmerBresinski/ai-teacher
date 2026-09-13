import { appButton, arrowIcon, button, cta, href } from "../components.mjs";
import { assetHref, examples, inWords } from "../examples-data.mjs";

const image = (slug, item, extra = "") =>
  `<img src="${href(assetHref(slug, item.src))}" alt="${item.alt.replaceAll('"', "&quot;")}" loading="lazy" ${extra}>`;

const count = examples.length;
const subjects = [...new Set(examples.map((example) => `${example.year} ${example.subject}`))];
// A lesson can ship with slides only, so nothing on the page may promise a worksheet that is not
// there. Every count and every list of materials is read from the manifests.
const anyWorksheet = examples.some((example) => example.worksheet);
const materials = (example) => (example.worksheet ? "slides, worksheet and answer key" : "slides");

const indexPage = {
  route: "/examples/",
  title: "Example lessons | DayBack",
  description: count
    ? `${count === 1 ? "A lesson" : `${inWords(count)[0].toUpperCase() + inWords(count).slice(1)} lessons`} made in DayBack from one line of brief: ${anyWorksheet ? "slides, worksheet and answer key" : "the slides"}, for ${subjects.join(" and ")}.`
    : "Lessons made in DayBack from one line of brief.",
  body:
    `<section class="ex-index-head">
      <h1>${count === 1 ? "A lesson made in DayBack." : "Lessons made in DayBack."}</h1>
      <p class="lead">Each lesson started as the one line of brief printed above it.</p>
    </section>
    <section class="ex-index-grid" aria-label="Example lessons">${examples
      .map(
        (example) => `<article class="ex-index-card">
        <a class="ex-index-shot" href="${href(`/examples/${example.slug}/`)}" tabindex="-1" aria-hidden="true">${image(example.slug, { src: example.slides[0].src, alt: "" }, 'width="1440" height="810"')}</a>
        <p class="ex-index-brief">“${example.brief}”</p>
        <p class="eyebrow">${example.year} ${example.subject}</p>
        <h2><a href="${href(`/examples/${example.slug}/`)}">${example.title}</a></h2>
        <p>${example.slides.length} slides${example.worksheet ? ", worksheet with answer key" : ""}</p>
        <a class="hm-link" href="${href(`/examples/${example.slug}/`)}">Open this lesson <span aria-hidden="true">${arrowIcon}</span></a>
      </article>`,
      )
      .join("")}</section>` +
    cta({
      title: "Type your own topic and<br>read the lesson it makes.",
      body: "A year group and a topic is enough to start.",
      actions: appButton("Create a lesson"),
    }),
};

const lessonPage = (example) => ({
  route: `/examples/${example.slug}/`,
  title: `${example.title} | ${example.year} ${example.subject} lesson | DayBack`,
  description: `A ${example.year} ${example.subject} lesson made in DayBack from the brief “${example.brief}”: ${example.slides.length} slides${example.worksheet ? ", a worksheet and the answer key" : ""}.`,
  body:
    `<section class="ex-lesson-head">
      <a class="ex-back" href="${href("/examples/")}">← All example lessons</a>
      <p class="eyebrow">${example.year} ${example.subject}</p>
      <h1>${example.title}</h1>
      <p class="lead">From the brief: “${example.brief}”</p>
    </section>
    <section class="ex-material" aria-labelledby="slides-heading">
      <h2 id="slides-heading">Slides</h2>
      <div class="ex-shots">${example.slides.map((slide) => `<figure>${image(example.slug, slide, 'width="1440" height="810"')}</figure>`).join("")}</div>
    </section>
    ${
      example.worksheet
        ? `<section class="ex-material" aria-labelledby="worksheet-heading">
      <h2 id="worksheet-heading">Worksheet</h2>
      <div class="ex-shots ex-shots-paper">${example.worksheet.pages.map((page) => `<figure>${image(example.slug, page)}</figure>`).join("")}</div>
    </section>
    ${
      example.worksheet.answers.length > 0
        ? `<section class="ex-material" aria-labelledby="answers-heading">
      <h2 id="answers-heading">Answer key</h2>
      <details class="ex-answers"><summary>Show answers<span aria-hidden="true">+</span></summary>
        <div class="ex-shots ex-shots-paper">${example.worksheet.answers.map((page) => `<figure>${image(example.slug, page)}</figure>`).join("")}</div>
      </details>
    </section>`
        : ""
    }`
        : ""
    }` +
    cta({
      title: example.worksheet
        ? "Your topic makes the same<br>three things for your class."
        : "Your topic makes a whole<br>lesson for your class.",
      body: "Type the year group and the topic. The whole lesson comes back checked.",
      actions:
        appButton("Create a lesson") +
        button("All example lessons", "/examples/", { secondary: true }),
    }),
});

export default [indexPage, ...examples.map(lessonPage)];
