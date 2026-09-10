import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { base } from "./config.mjs";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const routes = JSON.parse(await readFile(resolve(root, "routes.json"), "utf8"));
const errors = [];
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
    if (entry.isDirectory()) {
      await checkFiles(file);
      continue;
    }
    if (!/\.(html|css|js)$/.test(entry.name)) continue;
    const content = await readFile(file, "utf8");
    const from = base + file.slice(root.length - 1);
    if (/\/gather\/|localhost:4185/.test(content)) errors.push(`${from}: prototype dependency`);
    const targets = entry.name.endsWith(".html")
      ? [...content.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
      : entry.name.endsWith(".css")
        ? [...content.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map((match) => match[1])
        : [];
    for (const target of targets) await checkTarget(target, from);
  }
}
for (const { route } of routes) {
  const html = await readFile(resolve(root, `.${route}`, "index.html"), "utf8");
  if ((html.match(/<h1(?:\s|>)/g) || []).length !== 1) errors.push(`${route}: H1 count`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) errors.push(`${route}: duplicate IDs`);
  if (!html.includes("<main")) errors.push(`${route}: missing main`);
  if (!html.includes('content="noindex,nofollow"')) errors.push(`${route}: preview indexing guard`);
}
await checkFiles(root);
console.log(JSON.stringify({ pages: routes.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
