import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = { window: {} };
vm.runInNewContext(
  readFileSync(new URL("../motion/characters.js", import.meta.url), "utf8"),
  context,
);
const originals = context.window.characters;

import { appUrl, base } from "../config.mjs";

export { appUrl, base };
export const href = (route = "/") =>
  route.startsWith("#") ? route : `${base}${route.startsWith("/") ? "" : "/"}${route}`;
// Links into the application. Internal `href()` links stay inside the static site.
export const appHref = (path = "/") => `${appUrl}${path.startsWith("/") ? "" : "/"}${path}`;
export const contactEmail = "hello@dayback.app";
export const legalEntity = "DayBack Ltd";
export const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
// Vector artwork avoids OS-dependent emoji/font fallback for decorative arrows.
export const arrowIcon = `<svg class="arrow-icon" width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true" focusable="false"><path d="M2 22 22 2M16 2h6v6"/></svg>`;
// Arrow roles: the diagonal arrow means "into the application", the straight one means "somewhere
// else on this site". Both are vectors so emoji fonts cannot replace them.
export const nextIcon = `<svg class="arrow-icon" width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true" focusable="false"><path d="M1 12h21M16 6l6 6-6 6"/></svg>`;
export const button = (label, route = "/examples/", options = {}) =>
  `<a class="button ${options.secondary ? "button-secondary" : ""}" href="${options.external ? route : href(route)}">${label}<span aria-hidden="true">${options.app ? arrowIcon : nextIcon}</span></a>`;
export const appButton = (label, path = "/lessons/new", options = {}) =>
  button(label, appHref(path), { ...options, external: true, app: true });
// Creating a lesson is the one primary action. On the home page it returns to the hero form.
export const createButton = (home = false) =>
  home
    ? button("Create a lesson", "#start", { external: true, app: true })
    : appButton("Create a lesson");
export const textLink = (label, route, options = {}) =>
  `<a class="text-link" href="${options.external ? route : href(route)}">${label}<span aria-hidden="true">${options.app ? arrowIcon : nextIcon}</span></a>`;
// Every section opens the same way: optional eyebrow, one heading, optional lede, left-aligned.
export function sectionHead({ id, eyebrow = "", title, lede = "" }) {
  return `<div class="section-head">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h2${id ? ` id="${id}"` : ""}>${title}</h2>${lede ? `<p class="section-lede">${lede}</p>` : ""}</div>`;
}
export function character(kind = "slides", options = {}) {
  return `<div class="site-character ${options.className || ""}" data-character-copy="${kind}" aria-hidden="true">${originals[kind] || originals.slides}</div>`;
}
export function pageHero({ eyebrow = "", title, description = "", character: kind, actions = "" }) {
  return `<section class="page-hero container ${kind ? "with-character" : ""}"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ""}<h1>${title}</h1>${description ? `<p class="lead">${description}</p>` : ""}${actions ? `<div class="actions">${actions}</div>` : ""}</div>${kind ? (originals[kind] ? character(kind) : kind) : ""}</section>`;
}
// One closing invitation, identical on every page that has one.
export function cta({ home = false, secondary = "" } = {}) {
  return `<section class="section closing-block" aria-labelledby="closing-title"><div class="container closing-inner"><div><h2 id="closing-title">Start with the lesson<br>you’re teaching tomorrow.</h2><p>A year group and a topic is enough.</p><div class="actions">${createButton(home)}${secondary}</div></div>${character("answers")}</div></section>`;
}
export function shell(page) {
  const home = page.route === "/";
  const nav = [
    ["Top lessons", href("/examples/")],
    ["FAQ", href("/help/")],
    ["Sign in", appHref("/sign-in")],
  ];
  const footerProduct = [
    ["Top lessons", href("/examples/")],
    ["FAQ", href("/help/")],
    ["About", href("/about/")],
    ["Create a lesson", home ? "#start" : appHref("/lessons/new")],
  ];
  const footerTrust = [
    ["AI and your data", href("/trust/")],
    ["Accessibility", href("/accessibility/")],
    ["Privacy", href("/privacy/")],
    ["Terms", href("/terms/")],
    ["Cookies", href("/cookies/")],
  ];
  const link = ([label, target]) =>
    `<a href="${target}"${page.route !== "/" && target === href(page.route) ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(page.title)}</title><meta name="description" content="${escapeHtml(page.description)}"><link rel="icon" href="${href("/assets/favicon.svg")}" type="image/svg+xml"><link rel="stylesheet" href="${href("/assets/system.css")}">${["home", "examples", "information"].map((n) => `<link rel="stylesheet" href="${href(`/assets/${n}.css`)}">`).join("")}<link rel="stylesheet" href="${href("/motion/cast.css")}"></head><body data-living-cast><a class="skip" href="#main">Skip to content</a><header class="site-header container"><a class="brand" href="${href("/")}" aria-label="DayBack home">DayBack<span aria-hidden="true">✳︎</span></a><button class="menu-toggle" aria-expanded="false" aria-controls="main-nav">Menu <span aria-hidden="true">+</span></button><nav id="main-nav" aria-label="Main navigation">${nav.map(link).join("")}<a class="nav-cta" href="${home ? "#start" : appHref("/lessons/new")}">Create a lesson<span aria-hidden="true">${arrowIcon}</span></a></nav></header><main id="main">${page.body}</main><footer class="site-footer"><div class="container"><div class="footer-top"><div><a class="brand" href="${href("/")}">DayBack<span aria-hidden="true">✳︎</span></a><p>Outstanding lessons.<br>Without losing your evening.</p></div><div class="footer-group"><h2>The product</h2>${footerProduct.map(link).join("")}</div><div class="footer-group"><h2>Trust</h2>${footerTrust.map(link).join("")}</div><div class="footer-group"><h2>Get in touch</h2><p>Questions, or a lesson that came out wrong?<br><a href="mailto:${contactEmail}">${contactEmail}</a></p></div></div><div class="footer-bottom"><span class="footer-legal">© 2026 ${legalEntity}</span></div></div></footer><script src="${href("/motion/vendor/gsap.min.js")}"></script><script src="${href("/motion/cast.js")}"></script><script src="${href("/assets/site.js")}"></script>${(page.scripts || []).map((src) => `<script src="${href(src)}"></script>`).join("")}</body></html>`;
}
