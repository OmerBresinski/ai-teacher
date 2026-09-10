import { arrowIcon, button, character, cta, href, pageHero, split } from "../components.mjs";
import { lessonData } from "./examples.mjs";

const shadows = lessonData.shadows;

const sample = (label, hash) => button(label, `/examples/shadows/#${hash}`);
const note = '<p class="ft-caption">Prepared sample · Year 3 science · How shadows change</p>';
const featureLinks = [
  ["lesson-plans", "Lesson plans"],
  ["slides", "Slides"],
  ["worksheets", "Worksheets"],
  ["answers", "Answers"],
  ["lesson-checks", "Lesson checks"],
];
function related(current) {
  return `<section class="ft-related" aria-labelledby="ft-related-title"><p class="eyebrow">One lesson, working together</p><h2 id="ft-related-title">Meet the rest of the materials.</h2><nav aria-label="Related lesson features">${featureLinks
    .filter(([slug]) => slug !== current)
    .map(
      ([slug, label]) =>
        `<a href="${href(`/features/${slug}/`)}">${label}<span aria-hidden="true">${arrowIcon}</span></a>`,
    )
    .join("")}</nav></section>`;
}
const preview = (label, title, content, modifier = "") =>
  `<section class="ft-sample ${modifier}" aria-labelledby="ft-sample-title"><div class="ft-sample-heading"><p class="eyebrow">${label}</p><h2 id="ft-sample-title">${title}</h2></div>${content}${note}</section>`;

const plan = `<div class="ft-plan"><header><span class="ft-paper-label">The learning goal</span><h3>${shadows.goal}</h3><p>${shadows.year} science <span aria-hidden="true">·</span> 40 minutes</p></header><ol class="ft-timeline">${shadows.plan.map(([time, title, body]) => `<li><span class="ft-time">${time}</span><div><h4>${title}</h4><p>${body}</p></div></li>`).join("")}</ol></div>`;

const slides = `<div class="ft-slide-set"><article class="ft-slide ft-slide-main"><span class="ft-paper-label">03 / ${shadows.slides[2][0]}</span><h3>${shadows.slides[2][0]}</h3>${shadows.diagram}<p class="ft-discuss">${shadows.slides[2][1]}</p></article><div class="ft-slide-strip" aria-label="Sample teaching sequence">${shadows.slides.map(([title], i) => `<div${i === 2 ? ' class="ft-slide-current"' : ""}><span>0${i + 1}</span>${title}</div>`).join("")}</div></div>`;

const worksheet = `<article class="ft-worksheet"><header><span class="ft-paper-label">Science / Pupil copy · First two questions</span><h3>${shadows.title}</h3><p>Use the lesson and your observations to answer these questions.</p></header>${shadows.questions
  .slice(0, 2)
  .map(
    (question, i) =>
      `<div class="ft-question"><span class="ft-question-number">${i + 1}</span><div><h4>${question}</h4><div class="ft-writing-lines" aria-hidden="true"></div></div></div>`,
  )
  .join(
    "",
  )}<aside class="ft-word-bank"><span class="ft-paper-label">Words to help</span><p>${shadows.bank}</p></aside></article>`;

const answers = `<div class="ft-answer-pair"><article class="ft-question-card"><span class="ft-paper-label">Pupil question / 03</span><h3>${shadows.questions[2]}</h3><div class="ft-writing-lines" aria-hidden="true"></div></article><article class="ft-answer-card"><span class="ft-paper-label">Teacher answer / 03</span><p class="ft-answer-response">${shadows.answers[2]}</p><div class="ft-answer-note"><strong>Room for their own words</strong><p>Accept equivalent explanations that demonstrate the learning goal. Review the material for your class before teaching.</p></div></article></div>`;

const review = `<div class="ft-review"><article class="ft-review-item"><div class="ft-review-state"><span aria-hidden="true">✓</span> Clarified</div><h3>Make the investigation precise.</h3><p class="ft-review-location">Slide 3 · ${shadows.slides[2][0]}</p><div class="ft-revision"><div><span class="ft-paper-label">Before</span><p>${shadows.reviewBefore}</p></div><div><span class="ft-paper-label">After</span><p>${shadows.reviewAfter}</p></div></div><p class="ft-review-reason">${shadows.reviewWhy}</p></article><article class="ft-review-item ft-review-attention"><div class="ft-review-state"><span aria-hidden="true">${arrowIcon}</span> Teacher review</div><h3>Check the practical setup.</h3><p>${shadows.reviewAttention}</p><a href="${href("/examples/shadows/#review")}">See the issue in the sample <span aria-hidden="true">${arrowIcon}</span></a></article></div>`;

const pages = [
  {
    route: "/features/lesson-plans/",
    title: "Editable lesson plans for teachers",
    description:
      "See a teaching sequence, timings and notes alongside the slides, worksheet and answers for your lesson.",
    body:
      pageHero({
        eyebrow: "The lesson plan",
        title: "See how the lesson will run.",
        description:
          "The learning goal, teaching sequence and timings, brought together. A plan for the materials—and room for your way of teaching.",
        character: "support",
        actions: sample("See a sample plan", "plan"),
      }) +
      preview(
        "A plan you can follow",
        "From a first question to a good explanation.",
        plan,
        "ft-sample-sage",
      ) +
      split({
        eyebrow: "Your class. Your approach.",
        title: "Make room for the way you teach.",
        body: "<p>Start with a discussion, spend longer on an example or move into practice sooner. A useful plan gives you a sequence to work from, without making every decision for you.</p><p>See how the prepared sample links teaching, practical work and independent practice.</p>",
        visual: `<div class="ft-note"><span class="ft-paper-label">A teacher’s margin note</span><p>“They already know what opaque means. Let’s give the investigation a little more time.”</p><span class="ft-note-rule" aria-hidden="true"></span>${character("support", { className: "ft-note-character" })}</div>`,
        reverse: true,
      }) +
      related("lesson-plans") +
      cta({
        title: "Follow the lesson through.",
        body: "Open the plan alongside the slides, practice and answers in our prepared sample.",
      }),
  },
  {
    route: "/features/slides/",
    title: "Teaching slides for your lesson",
    description: "Explore clear teaching slides alongside the lesson plan, worksheet and answers.",
    body:
      pageHero({
        eyebrow: "The slides",
        title: "Slides you can teach from.",
        description:
          "A clear explanation. An example to discuss. A question worth pausing for. All following the same lesson as the practice materials.",
        character: "slides",
        actions: sample("See sample slides", "slides"),
      }) +
      preview("Something to show", "One idea at a time.", slides, "ft-sample-yellow") +
      split({
        eyebrow: "Space for your teaching",
        title: "The explanation is only the beginning.",
        body: "<p>Good slides leave room for a discussion, a demonstration and a change of pace. The sample moves from an explanation to a prediction pupils can test.</p><p>We’re building editing and PowerPoint export so you can adapt the details and use your usual classroom setup.</p>",
        visual: `<div class="ft-teacher-note"><span class="ft-paper-label">Beside the slide</span><h3>Pause here.</h3><p>Ask pupils to predict what will happen before moving the torch.</p><p>What will we keep the same to make it a fair comparison?</p><span class="ft-hand-rule" aria-hidden="true"></span></div>`,
        reverse: true,
      }) +
      related("slides") +
      cta({
        title: "See the explanation become practice.",
        body: "Explore the slides and their accompanying worksheet in the prepared sample.",
      }),
  },
  {
    route: "/features/worksheets/",
    title: "Lesson worksheets with separate answers",
    description:
      "Explore practice that follows the teaching, with support for pupils and a separate answer key.",
    body:
      pageHero({
        eyebrow: "The worksheet",
        title: "Practice that follows the explanation.",
        description:
          "Questions that use the ideas from the lesson, with room for pupils to work things out.",
        character: "activity",
        actions: sample("See a sample worksheet", "worksheet"),
      }) +
      preview("From listening to trying", "Now it’s their turn.", worksheet) +
      split({
        eyebrow: "A little help, where it counts",
        title: "Different ways into the same idea.",
        body: "<p>A word bank can help pupils find the language. A prediction gives them something to test. An explanation asks them to think a little further.</p><p>Our sample includes support without changing the learning goal.</p>",
        visual: `<div class="ft-support-samples"><article><span class="ft-paper-label">A way in</span><h3>${shadows.questions[0]}</h3><p>Use the word bank to help you begin.</p></article><article><span class="ft-paper-label">A little further</span><h3>${shadows.questions[3]}</h3><p>Draw on what you observed in the practical.</p></article></div>`,
        tone: "sage",
        reverse: true,
      }) +
      related("worksheets") +
      cta({
        title: "See what pupils will work with.",
        body: "Read the prepared worksheet and its separate teacher answers.",
      }),
  },
  {
    route: "/features/answers/",
    title: "Answer keys for lesson worksheets",
    description:
      "Review answers beside the worksheet questions, with suggested responses and teaching notes.",
    body:
      pageHero({
        eyebrow: "The answers",
        title: "The answers belong with the questions.",
        description:
          "A separate teacher copy, with clear answers and room for the different ways pupils explain an idea.",
        character: "answers",
        actions: sample("See sample answers", "answers"),
      }) +
      preview(
        "The question and the thinking",
        "More useful than a tick.",
        answers,
        "ft-sample-salmon",
      ) +
      split({
        eyebrow: "Keep the explanation close",
        title: "Ready for “but why?”",
        body: "<p>Suggested responses help you prepare an explanation, while leaving room for questions with more than one answer.</p><p>The prepared sample keeps the answer key separate from the pupil worksheet, so you can read both without giving the answer away.</p>",
        visual: `<div class="ft-note"><span class="ft-paper-label">A useful follow-up</span><p>“How could we show that the object is blocking the light?”</p><span class="ft-note-rule" aria-hidden="true"></span>${character("answers", { className: "ft-note-character" })}</div>`,
        reverse: true,
      }) +
      related("answers") +
      cta({
        title: "Read the questions. Check the answers.",
        body: "See both sides of the practice in our prepared sample lesson.",
      }),
  },
  {
    route: "/features/lesson-checks/",
    title: "Lesson review and corrections",
    description:
      "Explore an example lesson review showing a clarified question and a practical point for teacher attention.",
    body:
      pageHero({
        eyebrow: "The lesson check",
        title: "See what needs a closer look.",
        description:
          "A correction is more useful when you can see what changed—and what still needs your judgement.",
        character: "answers",
        actions: sample("See an example review", "review"),
      }) +
      preview("A prepared review example", "The change, in context.", review) +
      split({
        eyebrow: "A second look, not the final word",
        title: "You decide what reaches your class.",
        body: "<p>We’re building Check to review generated lessons for factual errors, unclear questions and gaps in the materials. The review will show corrections and issues left for your attention.</p><p>Check can miss things. Review the content, answers and practical activities before teaching.</p>",
        visual: `<div class="ft-teacher-note"><span class="ft-paper-label">Your final look</span><h3>Right for this class?</h3><ul><li>Does the explanation make sense?</li><li>Do the questions practise the goal?</li><li>Is the practical activity suitable?</li></ul><a href="${href("/trust/")}">How we approach AI <span aria-hidden="true">${arrowIcon}</span></a></div>`,
        reverse: true,
      }) +
      related("lesson-checks") +
      cta({
        title: "See the lesson behind the review.",
        body: "Explore the materials alongside their prepared review notes.",
      }),
  },
];

export default pages;
