import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { base, indexable } from "./config.mjs";
import { canonicalUrl, shell, siteUrl, unlisted } from "./src/components.mjs";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const directory of ["assets", "motion"]) {
  await cp(new URL(`./${directory}/`, import.meta.url), new URL(`${directory}/`, output), {
    recursive: true,
  });
}
const pages = [];
// `examples` reads homepage/assets/examples/*/manifest.json, so a new lesson is a folder of
// exported images plus its manifest, never a code change.
for (const name of ["home", "examples", "information", "supporting"]) {
  const { default: list } = await import(`./src/pages/${name}.mjs`);
  pages.push(...list);
}
const seen = new Set();
for (const page of pages) {
  if (seen.has(page.route)) throw Error(`Duplicate route ${page.route}`);
  seen.add(page.route);
  const file = new URL(`.${page.route}index.html`, output);
  await mkdir(dirname(fileURLToPath(file)), { recursive: true });
  await writeFile(file, shell(page));
  if (page.route === "/404/") await writeFile(new URL("404.html", output), shell(page));
}
await writeFile(
  new URL("routes.json", output),
  JSON.stringify(
    pages.map(({ route, title }) => ({ route, title })),
    null,
    2,
  ),
);
// Crawl files belong to a domain-root build only. robots.txt never disallows a page: a crawler has
// to fetch a noindex page to see its noindex. The sitemap lists public pages only, and robots.txt
// points at it only when the build is indexable.
if (base === "") {
  const listed = pages.filter((page) => !unlisted.has(page.route) && !page.provisional);
  await writeFile(
    new URL("sitemap.xml", output),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed
      .map((page) => `  <url><loc>${canonicalUrl(page.route)}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );
  await writeFile(
    new URL("robots.txt", output),
    `User-agent: *\nAllow: /\n${indexable ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ""}`,
  );
}
console.log(
  `Built ${pages.length} DayBack pages into homepage/dist (${indexable ? "indexable" : "noindex"}).`,
);
