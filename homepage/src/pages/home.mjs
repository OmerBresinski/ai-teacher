import { arrowIcon, button, character, cta, href, pageHero, split } from "../components.mjs";
import { lessonData } from "./examples.mjs";

const shadows = lessonData.shadows;

const link = (label, url) =>
  `<a class="hm-link" href="${href(url)}">${label} <span aria-hidden="true">${arrowIcon}</span></a>`;
const shadowDiagram = `<svg class="hm-shadow-diagram" viewBox="0 0 360 155" role="img" aria-label="A torch shines towards a toy. The toy blocks the light, casting a shadow on a screen."><path d="M57 84 311 20 311 138Z" fill="#f9e6a9"/><path d="M160 58 310 25 310 137 160 108Z" fill="#889885" opacity=".36"/><path d="M310 15V142" stroke="#53674e" stroke-width="5"/><path d="M30 72h37v26H30Z" fill="#efa991" stroke="#293b32" stroke-width="2"/><path d="M66 68v34" stroke="#293b32" stroke-width="3"/><path d="M148 63q12-20 24 0v39h-24Z" fill="#293b32"/><circle cx="160" cy="51" r="10" fill="#293b32"/><path d="M158 102v18m7-18v18" stroke="#293b32" stroke-width="5"/><path d="M296 49q10-28 18 0v59h-18Z" fill="#516357"/><text x="23" y="143">Light source</text><text x="140" y="145">Object</text><text x="277" y="155">Shadow</text></svg>`;
const materials = `<div class="hm-materials"><article class="hm-slide"><span class="hm-meta">SLIDE 03 · PREDICT & OBSERVE</span><h3>${shadows.slides[2][0]}</h3>${shadowDiagram}<p>${shadows.slides[2][1]}</p></article><article class="hm-worksheet"><span class="hm-meta">YOUR TURN · WORKSHEET</span><h3>Move the torch.<br>What changes?</h3><p><b>1.</b> ${shadows.questions[0]}</p><div class="hm-answer-line"></div><p><b>2.</b> ${shadows.questions[1]}</p><div class="hm-answer-line"></div><div class="hm-wordbank"><span>light</span><span>blocks</span><span>bigger</span></div></article><span class="hm-material-note">One idea, carried all the way through.</span></div>`;
const review = `<div class="hm-review"><div class="hm-review-top"><span class="hm-meta">EXAMPLE LESSON REVIEW</span><span class="hm-review-badge">Check</span></div><h3>A second look.<br>A clearer lesson.</h3><div class="hm-review-item"><span class="hm-review-icon" aria-hidden="true">✓</span><div><b>A clearer investigation</b><p>Slide 3</p><del>${shadows.reviewBefore}</del><ins>${shadows.reviewAfter}</ins></div></div><div class="hm-review-item hm-review-attention"><span class="hm-review-icon" aria-hidden="true">!</span><div><b>One for you to review</b><p>${shadows.reviewAttention}</p></div></div><p class="hm-review-note">An illustrative review. Check can miss things; review the lesson before teaching.</p></div>`;
const note = `<div class="hm-note-scene"><div class="hm-note"><span class="hm-meta">A NOTE FROM YOU</span><p>“Year 3 science, 40 minutes. Explore how moving a torch changes a shadow. Include a practical activity and a word bank.”</p><span class="hm-note-sign">A little context goes a long way.</span></div><div class="hm-note-tags"><span>Your topic</span><span>Your notes</span><span>A resource to reuse</span></div></div>`;
const edit = `<div class="hm-edit"><div class="hm-edit-bar"><span class="hm-meta">WORKSHEET · A LITTLE SUPPORT</span><span aria-hidden="true">✳</span></div><h3>Find the words.<br>Then find your voice.</h3><p>“The toy blocks the <span class="hm-blank"></span>. When the torch moves closer, the shadow gets <span class="hm-blank"></span>.”</p><div class="hm-wordbank"><span>light</span><span>bigger</span><span>smaller</span></div><div class="hm-edit-add">A further question</div><p class="hm-edit-extension">Can you make the same shadow size with the torch in a different position?</p></div>`;
const outputs = `<div class="hm-outputs"><div><span class="hm-file yellow" aria-hidden="true">P</span><p><b>Slides</b><span>Present or export to PowerPoint</span></p></div><div><span class="hm-file green" aria-hidden="true">W</span><p><b>Worksheet</b><span>A pupil copy, ready to adapt</span></p></div><div><span class="hm-file coral" aria-hidden="true">✓</span><p><b>Answers</b><span>A separate copy for you</span></p></div><p class="hm-output-note">The teaching stays in your hands.</p></div>`;
const team = [
  [
    "support",
    "Lesson plan",
    "The sequence, timings and teaching notes.",
    "/features/lesson-plans/",
  ],
  ["slides", "Slides", "Explanations and examples to share.", "/features/slides/"],
  ["activity", "Worksheet", "Practice, with a separate answer key.", "/features/worksheets/"],
  ["answers", "Answers", "A separate key to work through.", "/features/answers/"],
];

const home = {
  route: "/",
  title: "Gather | Editable lesson plans, slides and worksheets",
  description:
    "Meet Gather: lesson preparation for teachers, with plans, slides, worksheets and answers that work together.",
  body: `
<section class="hm-hero" aria-labelledby="home-title"><p class="eyebrow">A LITTLE HELP FOR TEACHERS.</p><h1 id="home-title">Good company<br>for a good lesson.</h1><p class="hm-promise">Turn a topic or your own material into a lesson plan,<br class="hm-wide"> slides, a worksheet and answers you can edit.</p><div class="actions">${button("Try a sample lesson", "/examples/")}${link("How it works", "/how-it-works/")}</div><p class="hm-preview-note">In development. Come and explore a prepared lesson.</p>
<div class="hm-team" aria-label="Meet the lesson team">${team.map(([kind, name, desc, url]) => `<a href="${href(url)}" class="hm-teammate">${character(kind)}<h2>${name}</h2><p>${desc}</p></a>`).join("")}</div></section>
<div class="hm-sample-label"><span>YEAR 3 SCIENCE · HOW SHADOWS CHANGE</span><span>Prepared sample lesson</span></div>
${split({ eyebrow: "ONE LESSON, ALL TOGETHER", title: "Materials that<br>work together.", body: `<p>The worksheet practises the ideas introduced in the slides, with answers for each question.</p>${link("Explore the sample", "/examples/shadows/")}`, visual: materials, tone: "sage" })}
${split({ eyebrow: "A THOUGHTFUL SECOND LOOK", title: "See what the<br>lesson review finds.", body: `<p>The example review shows a clarified question and a point for your attention.</p>${link("See an example review", "/features/lesson-checks/")}`, visual: review, reverse: true })}
${split({ eyebrow: "START WHERE YOU ARE", title: "Bring what<br>you already have.", body: `<p>A topic, a page of notes or a resource you want to reuse. Tell us the year group and what the class needs to learn.</p>${link("From brief to lesson", "/how-it-works/")}`, visual: note, tone: "peach" })}
${split({ eyebrow: "YOU’RE STILL THE TEACHER", title: "Make room<br>for your class.", body: `<p>A word bank for someone finding their feet. A further question for someone ready to go deeper.</p><p>Edit the materials and choose how the lesson runs. You know the people in the room.</p>${link("Explore the worksheet", "/features/worksheets/")}`, visual: edit, reverse: true })}
${split({ eyebrow: "FROM YOUR DESK TO THEIRS", title: "Take it into<br>the classroom.", body: `<p>We’re building Gather so you can present your slides or export them to PowerPoint, with the worksheet and answers kept separate for printing.</p>${link("See what’s included", "/examples/")}`, visual: outputs, tone: "sage" })}
${cta({ title: "You bring the teaching.<br>We’ll bring good company.", body: "Take a look around a complete sample lesson. See how the explanation, practice and answers fit together." })}`,
};
const how = {
  route: "/how-it-works/",
  title: "How Gather works | From a topic to an editable lesson",
  description:
    "See the Gather workflow: start with a brief, review the materials and make the lesson yours.",
  body: `
${pageHero({ eyebrow: "FROM YOUR IDEA TO THEIR “I GET IT”", title: "A little context.<br>A lesson to make yours.", description: "Gather is being built to use AI for the preparation around your teaching. You choose the class, the learning goal and what to change.", actions: button("Explore a sample lesson", "/examples/") })}
<div class="hm-how">
${split({ eyebrow: "01 / YOUR STARTING POINT", title: "Tell us what<br>you’re teaching.", body: "<p>Start with a topic or your own material. Add the year group, lesson length and anything useful about the class’s prior knowledge.</p><p>Class-level context is enough. Leave out pupil names and records.</p>", visual: note })}
<section class="hm-teamwork"><div class="hm-teamwork-copy"><p class="eyebrow">02 / A LITTLE TEAMWORK</p><h2>The whole lesson<br>comes along.</h2><p>A plan to follow. Slides to explain. Questions to try. Answers to work through.</p><p>Open the materials together and follow the same idea from explanation to practice.</p></div><div class="hm-teamwork-stage"><iframe src="${href("/lesson-building/?embed=1")}" title="Animated preview of the Gather team assembling a lesson" loading="lazy"></iframe><p>Workflow animation · not live generation</p></div></section>
${split({ eyebrow: "03 / A SECOND LOOK", title: "Read the<br>lesson review.", body: `<p>Check is designed to show corrections made during generation and issues that remain.</p><p>Open the review to see what needs a closer look before teaching. It can miss errors; your judgement still matters.</p>${link("Explore lesson checks", "/features/lesson-checks/")}`, visual: review, reverse: true, tone: "sage" })}
${split({ eyebrow: "04 / YOUR WAY FROM HERE", title: "Make it yours.", body: `<p>Edit the wording, swap an example or change the order. Add support or a question that asks a little more.</p><p>The planned workflow includes presenting from Gather and exporting the materials for your usual teaching setup.</p>${link("Look around the sample", "/examples/")}`, visual: edit })}
</div>${cta({ title: "Meet your next<br>little starting point.", body: "Explore a prepared lesson, from the plan through to the answers." })}`,
};
export default [home, how];
