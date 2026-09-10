import { arrowIcon, href } from "../components.mjs";
import { lessonData } from "./examples.mjs";

const samples = ["shadows", "states-of-matter", "conservation-of-mass"];
export function homeSamples() {
  return `<section class="hm-samples" id="sample-lessons" aria-labelledby="samples-title" data-home-samples>
<div class="hm-samples-heading"><div><p class="eyebrow">ONE LESSON, ALL TOGETHER</p><h2 id="samples-title">See how it fits.</h2><p>One idea, from explanation to practice.</p></div><div class="hm-sample-tabs" aria-label="Choose a sample lesson">${samples.map((slug, i) => `<a href="${href(`/examples/${slug}/`)}" id="sample-tab-${slug}" data-sample-tab="${slug}"${i === 0 ? ' class="is-selected"' : ""}>${lessonData[slug].year}</a>`).join("")}</div></div>
${samples
  .map((slug, i) => {
    const d = lessonData[slug];
    const slideIndex = d.homeSlide ?? 2;
    const [title, body, visual] = d.slides[slideIndex];
    return `<div id="sample-${slug}" data-sample-panel="${slug}"${i ? " hidden" : ""}>
<div class="hm-sample-context"><h3>${d.year} ${d.subject || "science"} · ${d.title}</h3><span>Prepared sample</span></div>
<div class="hm-sample-papers"><article class="hm-sample-slide"><p class="hm-meta">TEACHING SLIDE · ${String(slideIndex + 1).padStart(2, "0")}</p><h4>${title}</h4>${visual}<p>${body}</p></article>
<article class="hm-sample-worksheet"><p class="hm-meta">WORKSHEET</p><h4>Now it’s your turn.</h4><ol>${d.questions
      .slice(0, 2)
      .map(
        (question) => `<li>${question}<div class="hm-answer-line" aria-hidden="true"></div></li>`,
      )
      .join(
        "",
      )}</ol><details class="hm-sample-answers"><summary>Show the answers</summary><ol>${d.answers
      .slice(0, 2)
      .map((answer) => `<li>${answer}</li>`)
      .join("")}</ol></details></article></div>
<a class="hm-link hm-sample-open" href="${href(`/examples/${slug}/`)}">Explore this lesson <span aria-hidden="true">${arrowIcon}</span></a></div>`;
  })
  .join("")}</section>`;
}
