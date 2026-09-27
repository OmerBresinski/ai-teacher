import { appHref, arrowIcon, cta, sectionHead, textLink } from "../components.mjs";
import { examples } from "../examples-data.mjs";
import { heroCharacter } from "../hero-artwork.mjs";
import { lessonGrid } from "../lesson-card.mjs";
import { lessonProof } from "../lesson-proof.mjs";
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
  body: hero + lessonProof + topLessons + howItWorks + faq + cta({ home: true }),
};

export default [home];
