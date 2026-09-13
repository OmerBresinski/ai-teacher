import { appHref, arrowIcon, button, cta, href } from "../components.mjs";
import { assetHref, examples, inWords } from "../examples-data.mjs";
import { heroCharacter } from "../hero-artwork.mjs";

const uploadIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>`;

const hero = `
<section class="hm-hero-band" aria-labelledby="home-title">
  <div class="hm-hero-intro"><h1 id="home-title">Outstanding lessons.<br>Without losing your evening.</h1></div>
  <div class="hm-hero-stage">
    ${heroCharacter("slides", "slides")}${heroCharacter("activity", "worksheet")}${heroCharacter("support", "plan")}${heroCharacter("answers", "check")}
    <form class="hm-brief" id="start" method="get" action="${appHref("/lessons/new")}">
      <label for="hero-topic">What are you teaching?</label>
      <div class="hm-brief-row">
        <div class="hm-brief-field">
          <input id="hero-topic" name="topic" required maxlength="500" placeholder="Year 8 English: writing a persuasive speech" autocomplete="off">
          <a class="hm-brief-upload" href="${appHref("/lessons/new?source=1")}" aria-label="Start from your own PowerPoint, PDF or Word file">${uploadIcon}<span class="hm-brief-tooltip" aria-hidden="true">Or start from your own PowerPoint, PDF or Word file.</span></a>
        </div>
        <button type="submit">Create a lesson ${arrowIcon}</button>
      </div>
    </form>
    <p class="hm-grounded-subtitle">Your topic or materials. A complete lesson, ready to edit.</p>
  </div>
  <button class="hm-hero-pause" data-pause-hero aria-pressed="false" hidden>Pause motion</button>
</section>`;

// Both the heading and the count come from the manifests, so the page never names a lesson it
// cannot show.
const count = examples.length;
const exampleStrip = count
  ? `
<section class="hm-examples" id="examples" aria-labelledby="examples-title">
  <div class="hm-examples-heading">
    <p class="eyebrow">MADE IN DAYBACK</p>
    <h2 id="examples-title">${count === 1 ? "A lesson,<br>start to finish." : `${inWords(count)[0].toUpperCase() + inWords(count).slice(1)} lessons,<br>start to finish.`}</h2>
    <p>Every slide, question and answer below came back from a one-line brief.</p>
  </div>
  <div class="hm-example-list">${examples
    .map(
      (example) => `<article class="hm-example-card">
      <a class="hm-example-shot" href="${href(`/examples/${example.slug}/`)}" tabindex="-1" aria-hidden="true"><img src="${href(assetHref(example.slug, example.slides[0].src))}" alt="" loading="lazy" width="1440" height="810"></a>
      <p class="hm-example-brief">“${example.brief}”</p>
      <p class="hm-example-caption">${example.year} ${example.subject} · ${example.slides.length} slides, worksheet and answer key</p>
      <a class="hm-link" href="${href(`/examples/${example.slug}/`)}">Open this lesson <span aria-hidden="true">${arrowIcon}</span></a>
    </article>`,
    )
    .join("")}</div>
</section>`
  : "";

const steps = [
  [
    "Say what you’re teaching.",
    "A year group and a topic is enough. Add the lesson length, what the class already knows, or your own file.",
  ],
  [
    "Get the whole lesson, checked.",
    "The slides and the worksheet are checked against each other before you open them. Anything left for you to check is flagged on the slide it sits on.",
  ],
  [
    "Make it yours.",
    "Rewrite an explanation or add a harder question. Then present from the browser, or export to PowerPoint, PDF or Word.",
  ],
];

const howItWorks = `
<section class="hm-steps" aria-labelledby="steps-title">
  <div class="hm-steps-heading">
    <p class="eyebrow">HOW IT WORKS</p>
    <h2 id="steps-title">One line in.<br>The whole lesson out.</h2>
  </div>
  <ol class="hm-step-list">${steps
    .map(
      ([title, body], index) =>
        `<li><span class="hm-step-number" aria-hidden="true">0${index + 1}</span><h3>${title}</h3><p>${body}</p></li>`,
    )
    .join("")}</ol>
</section>`;

const control = `
<section class="hm-control" aria-labelledby="control-title">
  <div>
    <h3 id="control-title">You stay in charge.</h3>
    <p>DayBack prepares the lesson. You decide what your class gets.</p>
    <p>Change anything before you teach it.</p>
  </div>
</section>`;

export const homeFaqs = [
  [
    "Which subjects and year groups?",
    "Any subject, Reception to Year 13. You pick the year group and the subject, and the lesson is written for that class.",
  ],
  [
    "Can I start from my own slides or documents?",
    "Yes. Upload up to three files, PDF, PowerPoint or Word, or paste text straight in.",
  ],
  [
    "Can I use it in PowerPoint, or print it?",
    "Lessons export as PowerPoint, PDF or PNG. Worksheets and answer keys export as PDF or Word. You can also present from the browser, or print any of it.",
  ],
  [
    "Do you store anything about my pupils?",
    "No. The brief asks about the class, not the children, and it blocks names, email addresses and ID numbers.",
  ],
  ["How much does it cost?", "DayBack is free for teachers right now."],
];

const faq = `
<section class="hm-faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Questions teachers ask.</h2>
  <div class="info-faq">${homeFaqs
    .map(
      ([question, answer]) =>
        `<details><summary>${question}<span aria-hidden="true">+</span></summary><div><p>${answer}</p></div></details>`,
    )
    .join("")}</div>
  <a class="hm-link" href="${href("/help/")}">All the questions teachers ask <span aria-hidden="true">${arrowIcon}</span></a>
</section>`;

const home = {
  route: "/",
  title: "DayBack | Slides, worksheet and answer key from one brief",
  description:
    "Type what you’re teaching. DayBack writes the slides, the worksheet and the answer key, checks they agree with each other, then hands them to you.",
  scripts: ["/assets/hero-motion.js"],
  body:
    hero +
    exampleStrip +
    howItWorks +
    control +
    faq +
    cta({
      title: "Start with the lesson<br>you’re teaching tomorrow.",
      body: "Type the year group and the topic. The whole lesson comes back checked.",
      actions:
        button("Create a lesson", "#start") +
        (count ? button("Open an example lesson", "/examples/", { secondary: true }) : ""),
    }),
};

export default [home];
