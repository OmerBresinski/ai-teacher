import { arrowIcon, button, character, cta, href, pageHero } from "../components.mjs";

import { upperYearLessons } from "./upper-year-lessons.mjs";

const shadowDiagram = `<svg class="ex-diagram" viewBox="0 0 560 260" role="img" aria-label="Light from a torch is blocked by a toy, creating a shadow on a screen"><path d="M99 117 470 38V222L99 143Z" fill="#f6d477" opacity=".45"/><path d="M280 110 470 70V192L280 150Z" fill="#293c34" opacity=".24"/><rect x="48" y="108" width="55" height="44" rx="8" fill="#d7e2c2" stroke="currentColor" stroke-width="3"/><path d="M103 111v38M280 155v39M267 194h26" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="280" cy="132" r="24" fill="#e6a083" stroke="currentColor" stroke-width="3"/><path d="M470 36v188" stroke="currentColor" stroke-width="4"/><text x="45" y="232">Torch</text><text x="259" y="232">Toy</text><text x="458" y="252">Screen</text></svg>`;
const particles = (type) => {
  let dots = "";
  const positions =
    type === "solid"
      ? Array.from({ length: 16 }, (_, i) => [38 + (i % 4) * 30, 36 + Math.floor(i / 4) * 30])
      : type === "liquid"
        ? [
            [35, 76],
            [64, 73],
            [92, 84],
            [124, 71],
            [45, 106],
            [75, 103],
            [104, 114],
            [134, 101],
            [31, 137],
            [64, 136],
            [98, 143],
            [131, 133],
          ]
        : [
            [28, 35],
            [120, 24],
            [78, 80],
            [137, 110],
            [29, 141],
            [100, 146],
          ];
  for (const [x, y] of positions) dots += `<circle cx="${x}" cy="${y}" r="9"/>`;
  return `<svg viewBox="0 0 166 174" role="img" aria-label="${type} particle arrangement"><rect x="7" y="7" width="152" height="160" rx="9" fill="none" stroke="currentColor" stroke-width="2"/><g fill="${type === "solid" ? "#dd9b79" : type === "liquid" ? "#809a77" : "#d1a13e"}">${dots}</g></svg>`;
};
const particleDiagram = `<div class="ex-particles">${["solid", "liquid", "gas"].map((v) => `<figure>${particles(v)}<figcaption>${v[0].toUpperCase() + v.slice(1)}</figcaption></figure>`).join("")}</div>`;
const data = {
  shadows: {
    title: "How shadows change",
    year: "Year 3",
    goal: "Explain how moving a light source changes a shadow.",
    intro:
      "A torch, a toy and a question worth exploring. Follow the idea from first explanation to independent practice.",
    brief:
      "Year 3 science, 40 minutes. Explore how moving a torch changes a shadow. Include a practical activity and a word bank for the written explanation.",
    diagram: shadowDiagram,
    plan: [
      [
        "5 min",
        "Notice",
        "Show a toy between a torch and a screen. Ask: what makes the dark shape?",
      ],
      [
        "8 min",
        "Explain",
        "Light travels in straight lines. An opaque object blocks light and a shadow forms behind it.",
      ],
      [
        "15 min",
        "Investigate",
        "Keep the toy and screen still. Move only the torch closer to and farther from the toy. Compare shadow sizes.",
      ],
      ["8 min", "Practise", "Complete the worksheet using observations and the word bank."],
      [
        "4 min",
        "Check understanding",
        "Ask pupils to explain why changing the distance changes the shadow.",
      ],
    ],
    notes:
      "Use a torch rather than a laser. Keep light out of eyes, leave walkways clear and supervise any room darkening. Use the same toy and screen position for each comparison.",
    slides: [
      [
        "Where did the shadow come from?",
        "What do you notice about the torch, the toy and the dark shape?",
        shadowDiagram,
      ],
      [
        "Light meets an obstacle",
        "An opaque object blocks light. A shadow forms on a surface behind the object.",
        '<div class="ex-big-thought">Light → object → shadow</div>',
      ],
      [
        "Change one thing",
        "Keep the toy and screen still. Move the torch closer to the toy. Predict first, then observe.",
        shadowDiagram,
      ],
      [
        "Explain what you found",
        "With the toy and screen fixed, moving the torch closer makes the shadow larger. Moving it farther away makes the shadow smaller.",
        '<div class="ex-big-thought">Closer torch.<br>Larger shadow.</div>',
      ],
    ],
    questions: [
      "Complete: A shadow forms when an object blocks ____.",
      "Keep the toy and screen still. Predict what happens to the shadow when you move the torch closer.",
      "Describe your result. What did you change? What did you keep the same?",
      "A friend says, “A shadow is always the same size as the object.” Explain why you disagree.",
    ],
    bank: "light · larger · smaller · torch · screen · blocks",
    answers: [
      "Light.",
      "The shadow gets larger when the torch moves closer, with the toy and screen fixed.",
      "For example: “I moved the torch closer. The shadow grew larger. I kept the toy and screen in the same places.” Accept a description consistent with the pupil’s observations.",
      "A shadow’s size depends on the positions of the light, object and surface. A closer torch can make a shadow larger than the object.",
    ],
    reviewBefore: "Move the torch closer. What happens?",
    reviewAfter:
      "Keep the toy and screen still. Move the torch closer to the toy. What happens to the shadow?",
    reviewWhy:
      "Names the moving object and the fixed objects, so the investigation has a clear comparison.",
    reviewAttention:
      "Check the classroom layout and the suitability of the torches before running the practical.",
  },
  "states-of-matter": {
    homeSlide: 1,
    title: "Solids, liquids and gases",
    year: "Year 7",
    goal: "Use the particle model to explain shape, flow and compression.",
    intro:
      "Make the invisible easier to reason about. Connect particle arrangements to the properties pupils can observe.",
    brief:
      "Year 7 science, 40 minutes. Introduce the particle model for solids, liquids and gases. Compare shape, flow and compression, and address the spaces-between-particles misconception.",
    diagram: particleDiagram,
    plan: [
      [
        "5 min",
        "Recall",
        "Compare an ice cube, water and air. Which keep their shape? Which can flow?",
      ],
      [
        "10 min",
        "Model",
        "Introduce particle arrangement and movement in each state. Explain that the dots are a simplified model.",
      ],
      [
        "10 min",
        "Explain together",
        "Connect gas compression to large gaps between particles. Compare with liquids and solids.",
      ],
      [
        "10 min",
        "Apply",
        "Complete the comparison and explanation questions independently, then discuss.",
      ],
      [
        "5 min",
        "Exit question",
        "Why can a liquid flow even though its particles are close together?",
      ],
    ],
    notes:
      "The diagrams are simplified and not to scale. The particles themselves do not expand when a substance changes state. In this model, the space between gas particles is not filled with air.",
    slides: [
      [
        "Same model. Three states.",
        "What could the arrangement of particles explain about each material?",
        particleDiagram,
      ],
      [
        "Close together does not mean fixed",
        "Solid particles vibrate about fixed positions. Liquid particles remain close together but can move past one another.",
        particleDiagram,
      ],
      [
        "Why are gases easy to compress?",
        "Gas particles are far apart. Compression reduces the gaps between them; it does not squash the particles.",
        '<div class="ex-big-thought">Smaller gaps.<br>Same particles.</div>',
      ],
      [
        "Use the model to explain",
        "A liquid takes the shape of its container but is difficult to compress. How can both statements be true?",
        '<div class="ex-big-thought">Arrangement + movement<br>→ properties</div>',
      ],
    ],
    questions: [
      "Compare the arrangement and movement of particles in a solid, a liquid and a gas.",
      "Explain why a liquid can flow but a solid keeps its shape.",
      "Explain why a gas is easier to compress than a liquid.",
      "A pupil says, “Air fills the spaces between gas particles.” Explain the problem with this statement.",
    ],
    bank: "particles · fixed positions · vibrate · move past · gaps · compress",
    answers: [
      "Solid: close together, vibrating about fixed positions. Liquid: close together, moving past each other. Gas: far apart, moving rapidly in all directions.",
      "Liquid particles can move past one another. In a solid they vibrate about fixed positions, so the solid keeps its shape.",
      "Gas particles have much larger gaps between them. Those gaps can be reduced. Liquid particles are already close together.",
      "Air is itself made of gas particles. In this simple particle model, the spaces between particles are empty, rather than filled by another substance.",
    ],
    reviewBefore: "Solid particles do not move.",
    reviewAfter: "Solid particles vibrate about fixed positions.",
    reviewWhy:
      "Corrects a common misconception while preserving a clear distinction from liquid particle movement.",
    reviewAttention:
      "Decide whether the class is ready to distinguish particle motion from changes in particle size during heating.",
  },
  ...upperYearLessons,
};
const section = (id, label, content) =>
  `<section id="${id}" class="ex-panel" role="tabpanel" aria-labelledby="tab-${id}" tabindex="0"><h2 class="ex-panel-heading">${label}</h2>${content}</section>`;
function lesson(slug, d) {
  return `<section class="ex-lesson-head"><a class="ex-back" href="${href("/examples/")}">← All sample lessons</a><p class="eyebrow">${d.year} ${d.subject || "science"} · 40 minutes</p><h1>${d.title}</h1><p>${d.intro}</p><p class="ex-disclosure">Prepared sample lesson · Explore the materials below.</p></section><div class="ex-workspace" data-example="${slug}"><div class="ex-tabs" role="tablist" aria-label="Lesson materials">${["plan", "slides", "worksheet", "answers", "review"].map((k, i) => `<button id="tab-${k}" role="tab" aria-selected="${i === 0}" aria-controls="${k}" tabindex="${i === 0 ? 0 : -1}" data-tab="${k}">${k === "review" ? "Lesson review" : k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>${section("plan", "The lesson plan", `<div class="ex-plan-top"><div><p class="eyebrow">Learning goal</p><p class="ex-goal">${d.goal}</p></div>${character("support", { className: "ex-helper" })}</div><ol class="ex-timings">${d.plan.map(([time, title, body]) => `<li><span>${time}</span><div><h3>${title}</h3><p>${body}</p></div></li>`).join("")}</ol><aside class="ex-note"><h3>Teacher notes</h3><p>${d.notes}</p></aside><details class="ex-brief"><summary>The brief behind this lesson</summary><p>“${d.brief}”</p></details>`)}${section("slides", "The teaching slides", `<div class="ex-slide-viewer">${d.slides.map(([title, body, visual], i) => `<article class="ex-slide" data-slide="${i}"${i ? " hidden" : ""}><p class="ex-slide-label">${d.year} ${d.subject || "science"}</p><h3>${title}</h3>${visual}<p>${body}</p></article>`).join("")}<div class="ex-slide-controls"><button type="button" data-slide-prev aria-label="Previous slide">←</button><span data-slide-count aria-live="polite">1 of ${d.slides.length}</span><button type="button" data-slide-next aria-label="Next slide">→</button></div></div><p class="ex-small">Prepared slide preview. Use the arrows to move through the explanation.</p>`)}${section("worksheet", "A little independent thinking", `<div class="ex-print-head"><div><p>${d.title}</p><p class="ex-name">Name: ____________________ &nbsp; Date: __________</p></div><button class="ex-print" data-print="worksheet" type="button">Print worksheet ${arrowIcon}</button></div><p>Use the lesson and your observations to answer these questions.</p><ol class="ex-questions">${d.questions.map((q) => `<li><p>${q}</p><div class="ex-answer-space" aria-hidden="true"></div></li>`).join("")}</ol><aside class="ex-word-bank"><strong>Words to help</strong><p>${d.bank}</p></aside>`)}${section("answers", "The teacher’s copy", `<div class="ex-print-head"><p>Suggested answers · ${d.title}</p><button class="ex-print" data-print="answers" type="button">Print answers ${arrowIcon}</button></div><ol class="ex-answer-key">${d.answers.map((a, i) => `<li><h3>${d.questions[i]}</h3><p>${a}</p></li>`).join("")}</ol><p class="ex-small">Accept equivalent explanations that demonstrate the learning goal. Review the material for your class before teaching.</p>`)}${section("review", "A closer look before teaching", `<p class="ex-review-disclosure">An illustrative review, prepared with this sample. These findings are authored examples, not the output of a live AI check.</p><div class="ex-correction"><p class="eyebrow">Example correction · Slide ${(d.reviewSlide ?? (slug === "shadows" ? 2 : 1)) + 1}</p><h3>${d.reviewTitle || (slug === "shadows" ? "Make the investigation precise" : "Correct the particle explanation")}</h3><div class="ex-before-after"><div><span>Before</span><p>${d.reviewBefore}</p></div><div><span>After</span><p>${d.reviewAfter}</p></div></div><p>${d.reviewWhy}</p><a href="#slides" data-open-slides="${d.reviewSlide ?? (slug === "shadows" ? 2 : 1)}">See the corrected slide ${arrowIcon}</a></div><aside class="ex-note"><h3>For your judgement</h3><p>${d.reviewAttention}</p></aside><p class="ex-small">A review can miss things. You decide what is suitable for your class.</p>`)}</div><div class="ex-after-sample"><p>From first explanation to the last answer.</p>${button("Explore more lessons", "/examples/", { secondary: true })}</div>`;
}
const pages = [
  {
    route: "/examples/",
    title: "Sample lesson plans, slides and worksheets | LessonCo",
    description:
      "Explore prepared science lessons from Year 3 to Year 9, from the plan through to worksheet answers.",
    body:
      pageHero({
        eyebrow: "Take a look inside",
        title: "Good company.<br>In practice.",
        description:
          "Explore a complete lesson, from the first explanation to the questions your class will answer.",
      }) +
      `<section class="ex-grid" aria-label="Prepared sample lessons">${Object.entries(data)
        .map(
          ([slug, d]) =>
            `<article class="ex-card"><a class="ex-card-visual" href="${href(`/examples/${slug}/`)}" aria-label="Explore ${d.title}">${d.diagram}</a><div class="ex-card-copy"><p class="eyebrow">${d.year} ${d.subject || "science"} · 40 minutes</p><h2><a href="${href(`/examples/${slug}/`)}">${d.title}</a></h2><p>${d.intro}</p>${button("Open the lesson", `/examples/${slug}/`, { secondary: true })}</div></article>`,
        )
        .join(
          "",
        )}</section><p class="ex-index-note">These are prepared sample lessons, not live AI results.</p>` +
      cta({
        title: "A starting point for your class.",
        body: "LessonCo is preparing for teacher testing. Hear when you can try it.",
        actions:
          button("Access and availability", "/pricing/") +
          button("Explore the Year 7 lesson", "/examples/states-of-matter/", { secondary: true }),
      }),
  },
  ...Object.entries(data).map(([slug, d]) => ({
    route: `/examples/${slug}/`,
    title: `${d.title} — ${d.year} sample lesson | LessonCo`,
    description: d.intro,
    body: lesson(slug, d),
  })),
];
export const lessonData = data;
export default pages;
