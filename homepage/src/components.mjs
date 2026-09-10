import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(
  readFileSync(new URL("../motion/characters.js", import.meta.url), "utf8"),
  context,
);
const originals = context.window.characters;

import { base } from "../config.mjs";

export { base };
export const href = (route = "/") =>
  route.startsWith("#") ? route : `${base}${route.startsWith("/") ? "" : "/"}${route}`;
export const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Vector artwork avoids OS-dependent emoji/font fallback for decorative arrows.
export const arrowIcon = `<svg class="arrow-icon" width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true" focusable="false"><path d="M2 22 22 2M16 2h6v6"/></svg>`;
export const button = (label, route = "/examples/", options = {}) =>
  `<a class="button ${options.secondary ? "button-secondary" : ""}" href="${href(route)}">${label}<span aria-hidden="true">${options.secondary ? "→" : arrowIcon}</span></a>`;
export function character(kind = "slides", options = {}) {
  return `<div class="site-character ${options.className || ""}" data-character-copy="${kind}" aria-hidden="true">${originals[kind] || originals.slides}</div>`;
}
export function pageHero({ eyebrow = "", title, description = "", character: kind, actions = "" }) {
  return `<section class="page-hero container ${kind ? "with-character" : ""}"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h1>${title}</h1>${description ? `<p class="lead">${description}</p>` : ""}${actions ? `<div class="actions">${actions}</div>` : ""}</div>${kind ? (originals[kind] ? character(kind) : kind) : ""}</section>`;
}
export function split({ eyebrow = "", title, body = "", visual = "", reverse = false, tone = "" }) {
  return `<section class="section ${tone ? `tone-${tone}` : ""}"><div class="container split ${reverse ? "split-reverse" : ""}"><div class="section-copy">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h2>${title}</h2><div class="prose">${body}</div></div><div class="section-visual">${visual}</div></div></section>`;
}
export function cta({
  title = "You bring the teaching.<br>We’ll bring good company.",
  body = "Explore a complete lesson. See what you’d make your own.",
  actions,
} = {}) {
  return `<section class="section closing-block"><div class="container closing-inner"><div><h2>${title}</h2><p>${body}</p><div class="actions">${actions || button("Explore a sample lesson", "/examples/") + button("Access and availability", "/pricing/", { secondary: true })}</div></div>${character("answers")}</div></section>`;
}
export function shell(page) {
  const nav = [
    ["How it works", "/how-it-works/"],
    ["Examples", "/examples/"],
    ["For schools", "/for-schools/"],
    ["Pricing", "/pricing/"],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(page.title.replace(/^LessonCo \| /, "").replace(/ \| LessonCo$/, ""))} | LessonCo</title><meta name="description" content="${escapeHtml(page.description)}"><link rel="icon" href="${href("/assets/favicon.svg")}" type="image/svg+xml"><link rel="stylesheet" href="${href("/assets/system.css")}">${["home", "features", "examples", "information"].map((n) => `<link rel="stylesheet" href="${href(`/assets/${n}.css`)}">`).join("")}<link rel="stylesheet" href="${href("/motion/cast.css")}"></head><body data-living-cast><a class="skip" href="#main">Skip to content</a><header class="site-header container"><a class="brand" href="${href("/")}" aria-label="LessonCo home">LessonCo<span aria-hidden="true">✳︎</span></a><button class="menu-toggle" aria-expanded="false" aria-controls="main-nav">Menu <span aria-hidden="true">+</span></button><nav id="main-nav" aria-label="Main navigation">${nav.map(([label, route]) => `<a href="${href(route)}" ${page.route === route ? 'aria-current="page"' : ""}>${label}</a>`).join("")}<a class="nav-cta" href="${href("/examples/shadows/")}">Explore a lesson <span aria-hidden="true">${arrowIcon}</span></a></nav></header><main id="main">${page.body}</main><footer class="site-footer"><div class="container"><div class="footer-top"><div><a class="brand" href="${href("/")}">LessonCo<span aria-hidden="true">✳︎</span></a><p>Lesson preparation for teachers.</p><p class="preview-note">A working preview. Explore prepared lessons;<br>live creation and accounts aren’t connected yet.</p></div><div class="footer-group"><h2>The materials</h2>${[
    ["Lesson plans", "lesson-plans"],
    ["Slides", "slides"],
    ["Worksheets", "worksheets"],
    ["Answers", "answers"],
    ["Lesson checks", "lesson-checks"],
  ]
    .map(([l, p]) => `<a href="${href(`/features/${p}/`)}">${l}</a>`)
    .join("")}</div><div class="footer-group"><h2>A little more</h2>${[
    ["About", "about"],
    ["Guides", "guides"],
    ["Help", "help"],
    ["Contact", "contact"],
    ["AI and your data", "trust"],
  ]
    .map(([l, p]) => `<a href="${href(`/${p}/`)}">${l}</a>`)
    .join(
      "",
    )}</div></div><div class="footer-bottom"><span>Good company for a good lesson.</span><div>${[
    ["Privacy", "privacy"],
    ["Terms", "terms"],
    ["Cookies", "cookies"],
    ["Accessibility", "accessibility"],
    ["Service providers", "service-providers"],
  ]
    .map(([l, p]) => `<a href="${href(`/${p}/`)}">${l}</a>`)
    .join(
      "",
    )}<button data-pause-cast aria-pressed="false">Pause motion</button></div></div></div></footer><script src="${href("/motion/vendor/gsap.min.js")}"></script><script src="${href("/motion/cast.js")}"></script><script src="${href("/assets/site.js")}"></script><script src="${href("/assets/examples.js")}"></script>${(page.scripts || []).map((src) => `<script src="${href(src)}"></script>`).join("")}</body></html>`;
}
