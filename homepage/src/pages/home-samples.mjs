import { arrowIcon, href } from "../components.mjs";

const waveDiagram = `<svg class="ex-diagram hm-sound-diagram" viewBox="0 0 560 250" role="img" aria-label="A vibrating ruler makes nearby air particles vibrate, carrying sound energy to an ear"><g fill="#dfa07e" stroke="currentColor" stroke-width="2"><circle cx="185" cy="125" r="10"/><circle cx="235" cy="125" r="10"/><circle cx="285" cy="125" r="10"/><circle cx="335" cy="125" r="10"/></g><path d="M72 52v145M72 125h74" fill="none" stroke="currentColor" stroke-width="5"/><path d="M142 94q32 31 0 62M165 82q44 43 0 86" fill="none" stroke="#c18441" stroke-width="4"/><path d="M390 82c42 0 73 18 73 43s-31 43-73 43c16-24 16-62 0-86Z" fill="#dce7ca" stroke="currentColor" stroke-width="3"/><path d="M421 112q22 13 0 27" fill="none" stroke="currentColor" stroke-width="3"/><g font-size="17" fill="currentColor" stroke="none"><text x="43" y="226">ruler</text><text x="215" y="226">air particles</text><text x="411" y="226">ear</text></g></svg>`;
const rulerTask = `<div class="hm-sound-task"><span>1. Hold the ruler still</span><span>2. Pluck the free end</span><span>3. Watch, listen, compare</span></div>`;
const lesson = {
  year: "Year 4",
  subject: "science",
  title: "How sound travels",
  slides: [
    [
      "Can you see a sound begin?",
      "Pluck the end of a ruler. What can you see, feel and hear?",
      rulerTask,
    ],
    [
      "Sound starts with a vibration",
      "The ruler moves rapidly back and forth. This vibration makes the nearby air particles vibrate too.",
      '<div class="ex-big-thought">vibration → sound</div>',
    ],
    [
      "The energy travels",
      "Particles vibrate about their positions and pass energy to neighbouring particles. The particles do not travel from the ruler to your ear.",
      waveDiagram,
    ],
    [
      "What if there were no particles?",
      "Sound needs a medium such as air, water or a solid. It cannot travel through a vacuum.",
      '<div class="ex-big-thought">vibration → medium → ear</div>',
    ],
    [
      "Predict, test, explain",
      "Shorten the free end of the ruler, then pluck it again. Predict how the sound will change and use the vibration to explain your result.",
      rulerTask,
    ],
  ],
};

export function homeSamples() {
  return `<section class="hm-samples hm-featured-sample" id="example" aria-labelledby="samples-title">
<div class="hm-samples-heading"><div><p class="eyebrow">${lesson.year} ${lesson.subject} · ${lesson.title}</p><h2 id="samples-title">See what you could teach.</h2><p>Browse a prepared primary lesson, one clear idea at a time.</p></div></div>
<div class="hm-sample-context"><h3>${lesson.year} ${lesson.subject} · ${lesson.title}</h3><span>Prepared sample</span></div>
<div class="ex-slide-viewer hm-inline-slides" data-example="sound">${lesson.slides.map(([title, body, visual], index) => `<article class="ex-slide" data-slide="${index}"${index ? " hidden" : ""}><p class="ex-slide-label">${lesson.year} ${lesson.subject}</p><h3>${title}</h3>${visual}<p>${body}</p></article>`).join("")}<div class="ex-slide-controls"><button type="button" data-slide-prev aria-label="Previous slide">←</button><span data-slide-count aria-live="polite">1 of ${lesson.slides.length}</span><button type="button" data-slide-next aria-label="Next slide">→</button></div></div>
<div class="hm-sample-actions"><a class="button" href="${href("#start")}">Try your own topic <span aria-hidden="true">${arrowIcon}</span></a></div></section>`;
}
