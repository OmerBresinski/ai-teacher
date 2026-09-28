import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { base, indexable, siteUrl } from "./config.mjs";
import { examples } from "./src/examples-data.mjs";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const source = fileURLToPath(new URL("./", import.meta.url));
const routes = JSON.parse(await readFile(resolve(root, "routes.json"), "utf8"));
const errors = [];

// The launch site. Example routes come from the manifests that actually have assets, so a lesson
// is never linked before its images exist.
const expectedRoutes = [
  "/",
  "/examples/",
  ...examples.map((example) => `/examples/${example.slug}/`),
  "/help/",
  "/about/",
  "/trust/",
  "/privacy/",
  "/terms/",
  "/cookies/",
  "/accessibility/",
  "/404/",
];
const built = routes.map(({ route }) => route);
for (const route of expectedRoutes) {
  if (!built.includes(route)) errors.push(`missing route ${route}`);
}
for (const route of built) {
  if (!expectedRoutes.includes(route)) errors.push(`unexpected route ${route}`);
}

// Routes cut for the launch. None of them may be linked or referenced anywhere in the output.
const removedRoutes = [
  "/how-it-works/",
  "/features/",
  "/guides/",
  "/for-schools/",
  "/pricing/",
  "/early-access/",
  "/contact/",
  "/service-providers/",
  "/design-system/",
  "/lesson-building/",
];

// Brand strings (ruling 65), work-in-progress language (ruling 66) and unfilled copy tokens.
const forbidden = [
  /\blessonco\b/i,
  /\blesson co\b/i,
  /\bgather\b/i,
  /\bgood compan(?:y|ies)\b/i,
  /\bpreviews?\b/i,
  /\bsamples?\b/i,
  /\bprototypes?\b/i,
  /\bplanned\b/i,
  /\bin development\b/i,
  /\bbeing prepared\b/i,
  /\bbeing built\b/i,
  /\bis designed to\b/i,
  /\bnot connected\b/i,
  /\bnothing was sent\b/i,
  /\bnothing is sent or saved\b/i,
  /\billustrative\b/i,
  /\bearly access\b/i,
  /\bcoming soon\b/i,
  /\bbeta\b/i,
  /\btesting\b/i,
  /\[EMAIL\]/,
  /\[LEGAL ENTITY\]/,
  /\[FACT/,
  /\[VERIFY/,
  /\[DECIDE/,
];

function scanText(content, label) {
  for (const pattern of forbidden) {
    const match = content.match(pattern);
    if (match) errors.push(`${label}: forbidden string "${match[0]}"`);
  }
  for (const route of removedRoutes) {
    if (content.includes(`${base}${route}`)) errors.push(`${label}: removed route ${route}`);
  }
}

async function checkTarget(target, from) {
  if (/^(https?:|data:|mailto:|tel:)/.test(target)) return;
  const url = new URL(target, `https://homepage.test${from}`);
  if (!url.pathname.startsWith(`${base}/`)) {
    errors.push(`${from}: escapes homepage ${target}`);
    return;
  }
  let file = resolve(root, `.${decodeURIComponent(url.pathname.slice(base.length))}`);
  try {
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const content = await readFile(file, "utf8");
    if (url.hash && file.endsWith(".html") && !content.includes(`id="${url.hash.slice(1)}"`)) {
      errors.push(`${from}: missing anchor ${target}`);
    }
  } catch {
    errors.push(`${from}: broken ${target}`);
  }
}

async function checkFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    // Vendored GSAP is third-party source and is never edited here.
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") await checkFiles(file);
      continue;
    }
    if (!/\.(html|css|js)$/.test(entry.name)) continue;
    const content = await readFile(file, "utf8");
    const from = base + file.slice(root.length - 1);
    if (/localhost:4185/.test(content)) errors.push(`${from}: local prototype dependency`);
    scanText(content, from);
    const targets = entry.name.endsWith(".html")
      ? [...content.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
      : entry.name.endsWith(".css")
        ? [...content.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map((match) => match[1])
        : [];
    for (const target of targets) await checkTarget(target, from);
  }
}

// The same string rules apply to the authored source, not only to the generated output.
async function checkSource(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (["dist", "node_modules", "vendor", "examples"].includes(entry.name)) continue;
      await checkSource(file);
      continue;
    }
    if (!/\.(mjs|js|css|md|json|svg)$/.test(entry.name)) continue;
    if (file === fileURLToPath(import.meta.url)) continue;
    scanText(await readFile(file, "utf8"), `src:${relative(source, file)}`);
  }
}

for (const { route, title } of routes) {
  const html = await readFile(resolve(root, `.${route}`, "index.html"), "utf8");
  if ((html.match(/<h1(?:\s|>)/g) || []).length !== 1) errors.push(`${route}: H1 count`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) errors.push(`${route}: duplicate IDs`);
  if (!html.includes("<main")) errors.push(`${route}: missing main`);
  // Indexing follows the build flags (TEACH-78): noindex everywhere unless --index, and always on
  // the 404 page and stand-in examples. Every other page names its canonical on the public site.
  const provisional = examples.some((e) => e.provisional && route === `/examples/${e.slug}/`);
  const wantNoindex = !indexable || route === "/404/" || provisional;
  if (html.includes('content="noindex,nofollow"') !== wantNoindex) {
    errors.push(`${route}: indexing guard (want ${wantNoindex ? "noindex" : "indexable"})`);
  }
  if (route !== "/404/") {
    const canonical = `<link rel="canonical" href="${siteUrl}${route}">`;
    if (!html.includes(canonical)) errors.push(`${route}: missing ${canonical}`);
    if (!html.includes(`<meta property="og:url" content="${siteUrl}${route}">`)) {
      errors.push(`${route}: og:url`);
    }
  } else if (html.includes('rel="canonical"')) errors.push(`${route}: 404 has a canonical`);
  const branded = route === "/" ? title.startsWith("DayBack | ") : title.endsWith(" | DayBack");
  if (!branded) errors.push(`${route}: title is not branded DayBack ("${title}")`);
  if (route !== "/" && /DayBack.*DayBack/.test(title)) errors.push(`${route}: duplicated suffix`);
}
// Each lesson page shows its slides in the viewer, and a worksheet only when its manifest has one.
for (const example of examples) {
  const html = await readFile(resolve(root, `./examples/${example.slug}/index.html`), "utf8");
  const label = `/examples/${example.slug}/`;
  const slides = (html.match(/class="viewer-slide[" ]/g) || []).length;
  if (slides !== example.slides.length) errors.push(`${label}: ${slides} slides in the viewer`);
  if (!html.includes("lesson-viewer.js")) errors.push(`${label}: missing slide viewer script`);
  if (html.includes(">Worksheet<") !== Boolean(example.worksheet)) {
    errors.push(`${label}: worksheet section does not match the manifest`);
  }
}
// A domain-root build carries its crawl files and never leaks the legacy /homepage prefix.
if (base === "") {
  const sitemap = await readFile(resolve(root, "sitemap.xml"), "utf8").catch(() => "");
  const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const wanted = expectedRoutes
    .filter((route) => route !== "/404/")
    .filter((route) => !examples.some((e) => e.provisional && route === `/examples/${e.slug}/`))
    .map((route) => `${siteUrl}${route}`);
  if (listed.join() !== wanted.join()) errors.push(`sitemap.xml lists ${listed.join(", ")}`);
  const robots = await readFile(resolve(root, "robots.txt"), "utf8").catch(() => "");
  if (!/^User-agent: \*$/m.test(robots) || /^Disallow: \/\s*$/m.test(robots)) {
    errors.push("robots.txt must exist and must not disallow the site");
  }
  if (robots.includes("Sitemap:") !== indexable) errors.push("robots.txt Sitemap line");
  for (const file of ["index.html", "404.html", "examples/index.html"]) {
    const html = await readFile(resolve(root, file), "utf8");
    if (/(?:href|src|action)="\/homepage\//.test(html)) errors.push(`${file}: /homepage prefix`);
  }
}
await checkFiles(root);
await checkSource(source);
console.log(JSON.stringify({ pages: routes.length, examples: examples.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
