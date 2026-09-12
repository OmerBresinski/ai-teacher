import { arrowIcon, button, cta, href, pageHero, split } from "../components.mjs";
import { heroCharacter } from "../hero-artwork.mjs";
import { lessonData } from "./examples.mjs";
import { homeSamples } from "./home-samples.mjs";

const shadows = lessonData.shadows;

const link = (label, url) =>
  `<a class="hm-link" href="${href(url)}">${label} <span aria-hidden="true">${arrowIcon}</span></a>`;
const review = `<div class="hm-review"><div class="hm-review-top"><span class="hm-meta">EXAMPLE LESSON REVIEW</span><span class="hm-review-badge">Check</span></div><h3>A second look.<br>A clearer lesson.</h3><div class="hm-review-item"><span class="hm-review-icon" aria-hidden="true">✓</span><div><b>A clearer investigation</b><p>Slide 3</p><del>${shadows.reviewBefore}</del><ins>${shadows.reviewAfter}</ins></div></div><div class="hm-review-item hm-review-attention"><span class="hm-review-icon" aria-hidden="true">!</span><div><b>One for you to review</b><p>${shadows.reviewAttention}</p></div></div><p class="hm-review-note">An illustrative review. Check can miss things; review the lesson before teaching.</p></div>`;
const note = `<div class="hm-note-scene"><div class="hm-note"><span class="hm-meta">A NOTE FROM YOU</span><p>“Year 3 science, 40 minutes. Explore how moving a torch changes a shadow. Include a practical activity and a word bank.”</p><span class="hm-note-sign">A little context goes a long way.</span></div><div class="hm-note-tags"><span>Your topic</span><span>Your notes</span><span>A resource to reuse</span></div></div>`;
const edit = `<div class="hm-edit"><div class="hm-edit-bar"><span class="hm-meta">WORKSHEET · A LITTLE SUPPORT</span><span aria-hidden="true">✳︎</span></div><h3>Find the words.<br>Then find your voice.</h3><p>“The toy blocks the <span class="hm-blank"></span>. When the torch moves closer, the shadow gets <span class="hm-blank"></span>.”</p><div class="hm-wordbank"><span>light</span><span>bigger</span><span>smaller</span></div><div class="hm-edit-add">A further question</div><p class="hm-edit-extension">Can you make the same shadow size with the torch in a different position?</p></div>`;

const home = {
  route: "/",
  title: "LessonCo | Editable lesson plans, slides and worksheets",
  description:
    "Meet LessonCo: lesson preparation for teachers, with plans, slides, worksheets and answers that work together.",
  scripts: ["/assets/home-samples.js", "/assets/hero-motion.js", "/assets/hero-preview.js"],
  body: `
<section class="hm-gather-hero" aria-labelledby="home-title">
  <div class="hm-hero-intro"><h1 id="home-title">Good company<br>for a good lesson.</h1><p>Turn a topic or your own material into a lesson plan,<br class="hm-hero-wide"> slides, a worksheet and answers you can edit.</p></div>
  <div class="hm-gathering">
    ${heroCharacter("slides", "slides")}${heroCharacter("activity", "worksheet")}${heroCharacter("support", "plan")}${heroCharacter("answers", "answers")}
    <form class="hm-brief" data-hero-preview>
      <label for="hero-topic">What would you like to teach?</label>
      <div class="hm-brief-row"><input id="hero-topic" data-brief-topic required maxlength="500" placeholder="e.g. Year 7 science — solids, liquids and gases" autocomplete="off"><button type="submit" disabled>Create a lesson ${arrowIcon}</button></div>
      <p class="hm-brief-status" data-brief-status role="status" aria-live="polite"></p>
      <noscript><p>This local preview needs JavaScript. Nothing is sent or saved.</p></noscript>
    </form>
  </div>
  <button class="hm-hero-pause" data-pause-hero aria-pressed="false" hidden>Pause motion</button>
</section>
${homeSamples()}
<section class="hm-preparation container" aria-labelledby="preparation-title"><p class="eyebrow">FROM YOUR DESK TO THEIRS</p><h2 id="preparation-title">A starting point.<br>Still your lesson.</h2><ol><li><h3>Bring your brief</h3><p>A topic, your notes or a resource to reuse. Add the class and learning goal.</p></li><li><h3>Take a second look</h3><p>Review the explanation, questions and suggested corrections. Your judgement matters.</p></li><li><h3>Make it yours</h3><p>Adapt the materials for your class and choose what reaches the classroom.</p></li></ol></section>
${cta({ title: "You bring the teaching.<br>We’ll bring good company.", body: "Take a look around a complete sample lesson. See how the explanation, practice and answers fit together." })}`,
};
const how = {
  route: "/how-it-works/",
  title: "How LessonCo works | From a topic to an editable lesson",
  description:
    "See the LessonCo workflow: start with a brief, review the materials and make the lesson yours.",
  body: `
${pageHero({ eyebrow: "FROM YOUR IDEA TO THEIR “I GET IT”", title: "A little context.<br>A lesson to make yours.", description: "LessonCo is being built to use AI for the preparation around your teaching. You choose the class, the learning goal and what to change.", actions: button("Explore a sample lesson", "/examples/") })}
<div class="hm-how">
${split({ eyebrow: "01 / YOUR STARTING POINT", title: "Tell us what<br>you’re teaching.", body: "<p>Start with a topic or your own material. Add the year group, lesson length and anything useful about the class’s prior knowledge.</p><p>Class-level context is enough. Leave out pupil names and records.</p>", visual: note })}
<section class="hm-teamwork"><div class="hm-teamwork-copy"><p class="eyebrow">02 / A LITTLE TEAMWORK</p><h2>The whole lesson<br>comes along.</h2><p>A plan to follow. Slides to explain. Questions to try. Answers to work through.</p><p>Open the materials together and follow the same idea from explanation to practice.</p></div><div class="hm-teamwork-stage"><iframe src="${href("/lesson-building/?embed=1")}" title="Animated preview of the LessonCo team assembling a lesson" loading="lazy"></iframe><p>Workflow animation · not live generation</p></div></section>
${split({ eyebrow: "03 / A SECOND LOOK", title: "Read the<br>lesson review.", body: `<p>Check is designed to show corrections made during generation and issues that remain.</p><p>Open the review to see what needs a closer look before teaching. It can miss errors; your judgement still matters.</p>${link("Explore lesson checks", "/features/lesson-checks/")}`, visual: review, reverse: true, tone: "sage" })}
${split({ eyebrow: "04 / YOUR WAY FROM HERE", title: "Make it yours.", body: `<p>Edit the wording, swap an example or change the order. Add support or a question that asks a little more.</p><p>The planned workflow includes presenting from LessonCo and exporting the materials for your usual teaching setup.</p>${link("Look around the sample", "/examples/")}`, visual: edit })}
</div>${cta({ title: "Meet your next<br>little starting point.", body: "Explore a prepared lesson, from the plan through to the answers." })}`,
};
export default [home, how];
