import { appHref, arrowIcon, character, cta, sectionHead, textLink } from "../components.mjs";
import { examples } from "../examples-data.mjs";
import { heroCharacter } from "../hero-artwork.mjs";
import { lessonGrid } from "../lesson-card.mjs";
import { faqList, faqs } from "./information.mjs";

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
          <input id="hero-topic" name="topic" required maxlength="500" placeholder="Year 8 English: persuasive speeches" autocomplete="off">
          <a class="hm-brief-upload" href="${appHref("/lessons/new?source=1")}" aria-label="Start from your own PowerPoint, PDF or Word file">${uploadIcon}<span class="hm-brief-tooltip" aria-hidden="true">Or start from your own PowerPoint, PDF or Word file.</span></a>
        </div>
        <button type="submit">Create a lesson ${arrowIcon}</button>
      </div>
    </form>
    <p class="hm-grounded-subtitle">Your topic or materials. A complete lesson, ready to edit.</p>
  </div>
</section>`;

// The proof is an illustration of one idea travelling through a lesson, not a screenshot of a
// real one. It renders in its finished state; proof.js only replays it when it scrolls into view.
const proof = `
<section class="section tone-sage hm-proof" aria-labelledby="proof-title">
  <div class="container">
    ${sectionHead({
      id: "proof-title",
      title: "Every part of the lesson agrees.",
      lede: "The slide teaches it, the worksheet practises it and the answer key marks it. DayBack checks all three against each other before you open them.",
    })}
    <div class="proof-stage" data-proof>
      <svg class="proof-links" aria-hidden="true" focusable="false"><path data-proof-link="0"/><path data-proof-link="1"/></svg>
      <figure class="proof-item proof-slide" data-proof-step="0">
        <div class="proof-art">
          <div class="proof-slide-card">
            <p class="proof-kicker">Year 4 science</p>
            <p class="proof-title">Sound starts with a vibration</p>
            <svg class="proof-diagram" viewBox="0 0 220 76" aria-hidden="true" focusable="false"><rect x="8" y="42" width="78" height="26" rx="3" class="proof-desk"/><path d="M28 42h96" class="proof-ruler"/><path d="M86 42l37-9M86 42l37 9" class="proof-ghost"/><path d="M142 26q10 16 0 32M158 18q16 24 0 48M174 10q22 32 0 64" class="proof-waves"/></svg>
            <p class="proof-line"><mark data-proof-anchor="0">Every sound starts with something vibrating.</mark></p>
          </div>
          ${character("slides", { className: "proof-character" })}
        </div>
        <figcaption><span>01</span>The slide teaches it.</figcaption>
      </figure>
      <figure class="proof-item proof-sheet" data-proof-step="1">
        <div class="proof-art">
          <div class="proof-paper">
            <p class="proof-kicker">Worksheet</p>
            <p class="proof-question proof-dim">1. Name two things that make a sound.</p>
            <p class="proof-question"><mark data-proof-anchor="1">2. What makes a sound start?</mark></p>
            <span class="proof-write" aria-hidden="true"></span>
            <p class="proof-question proof-dim">3. Why can’t sound travel in space?</p>
          </div>
          ${character("activity", { className: "proof-character" })}
        </div>
        <figcaption><span>02</span>The worksheet practises it.</figcaption>
      </figure>
      <figure class="proof-item proof-key" data-proof-step="2">
        <div class="proof-art">
          <div class="proof-paper proof-paper-key">
            <p class="proof-kicker">Answer key</p>
            <p class="proof-question proof-dim">1. Any two, e.g. a drum, a voice.</p>
            <p class="proof-question"><mark data-proof-anchor="2">2. Something vibrates.</mark></p>
            <p class="proof-question proof-dim">3. There are no particles to pass it on.</p>
          </div>
          ${character("answers", { className: "proof-character" })}
        </div>
        <figcaption><span>03</span>The answer key marks it.</figcaption>
      </figure>
    </div>
    <p class="proof-verdict" data-proof-verdict><span aria-hidden="true">✓</span> Checked together. Anything left for you to check is flagged where it sits.</p>
  </div>
</section>`;

const topLessons = examples.length
  ? `
<section class="section hm-lessons" aria-labelledby="lessons-title">
  <div class="container">
    <div class="hm-head-row">
      ${sectionHead({
        id: "lessons-title",
        title: "Top lessons.",
        lede: "Open one to see every slide, the worksheet and the answer key.",
      })}
      ${textLink("All top lessons", "/examples/")}
    </div>
    ${lessonGrid(examples.slice(0, 4))}
  </div>
</section>`
  : "";

const steps = [
  [
    "Say what you’re teaching.",
    "A year group and a topic is enough. Add what the class already knows, or start from your own file.",
  ],
  [
    "Get the whole lesson, checked.",
    "Slides with your notes, a worksheet and its answer key, checked against each other before you open them.",
  ],
  [
    "Make it yours.",
    "Change anything. Then present from the browser, or export to PowerPoint, PDF or Word.",
  ],
];

const howItWorks = `
<section class="section section-ruled hm-steps" aria-labelledby="steps-title">
  <div class="container">
    ${sectionHead({ id: "steps-title", title: "One line in.<br>The whole lesson out." })}
    <ol class="hm-step-list">${steps
      .map(
        ([title, body], index) =>
          `<li><span class="hm-step-number" aria-hidden="true">0${index + 1}</span><h3>${title}</h3><p>${body}</p></li>`,
      )
      .join("")}</ol>
  </div>
</section>`;

const faq = `
<section class="section section-ruled hm-faq" aria-labelledby="faq-title">
  <div class="container hm-faq-grid">
    <div>
      ${sectionHead({ id: "faq-title", title: "Questions teachers ask." })}
      ${textLink("All questions", "/help/")}
    </div>
    ${faqList(faqs.filter((item) => item.home))}
  </div>
</section>`;

const home = {
  route: "/",
  title: "DayBack | Outstanding lessons, without losing your evening",
  description:
    "Type what you’re teaching. DayBack writes the slides, the worksheet and the answer key, checks they agree with each other, then hands them to you.",
  scripts: ["/assets/hero-motion.js", "/assets/proof.js"],
  body: hero + proof + topLessons + howItWorks + faq + cta({ home: true }),
};

export default [home];
