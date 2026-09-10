import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shell } from "./src/components.mjs";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const directory of ["assets", "motion", "lesson-building", "loading-refined", "production"]) {
  await cp(new URL(`./${directory}/`, import.meta.url), new URL(`${directory}/`, output), {
    recursive: true,
  });
}
const pages = [];
for (const name of ["home", "features", "examples", "information", "supporting"]) {
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
console.log(`Built ${pages.length} LessonCo pages into homepage/dist.`);
