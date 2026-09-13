import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { allowProvisional } from "../config.mjs";

// Example lessons are data, not code: each lesson is a folder of exported images plus a manifest,
// so a real export replaces an authored stand-in without touching a page module.
const root = new URL("../assets/examples/", import.meta.url);

const readManifest = (slug) => {
  const file = new URL(`${slug}/manifest.json`, root);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const key of ["year", "subject", "title", "brief"]) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
      throw new Error(`examples/${slug}/manifest.json: ${key} must be a non-empty string`);
    }
  }
  const slides = Array.isArray(manifest.slides) ? manifest.slides : [];
  for (const slide of slides) {
    if (!slide || typeof slide.src !== "string" || typeof slide.alt !== "string" || !slide.alt) {
      throw new Error(`examples/${slug}/manifest.json: every slide needs a src and a real alt`);
    }
  }
  const worksheet = manifest.worksheet ?? {};
  // A worksheet page may be a bare path or a {src, alt} pair; a bare path gets a positional alt.
  const sheet = (list, label) =>
    (Array.isArray(list) ? list : []).map((entry, index) =>
      typeof entry === "string"
        ? { src: entry, alt: `${label} page ${index + 1} of ${manifest.title}` }
        : { src: entry.src, alt: entry.alt || `${label} page ${index + 1} of ${manifest.title}` },
    );
  const pages = sheet(worksheet.pages, "Worksheet");
  const answers = sheet(worksheet.answers, "Answer key");
  return {
    slug,
    year: manifest.year,
    subject: manifest.subject,
    title: manifest.title,
    brief: manifest.brief,
    provisional: manifest.provisional === true,
    slides,
    worksheet: { pages, answers },
  };
};

const slugs = readdirSync(fileURLToPath(root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((slug) => {
    try {
      return statSync(fileURLToPath(new URL(`${slug}/manifest.json`, root))).isFile();
    } catch {
      return false;
    }
  })
  .sort();

export const examples = [];
for (const slug of slugs) {
  const manifest = readManifest(slug);
  if (manifest.slides.length === 0 || manifest.worksheet.pages.length === 0) {
    console.warn(`Skipping example ${slug}: no slide or worksheet assets yet.`);
    continue;
  }
  if (manifest.provisional && !allowProvisional) {
    console.warn(`Skipping example ${slug}: assets are stand-ins; pass --allow-provisional.`);
    continue;
  }
  examples.push(manifest);
}

const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const inWords = (count) => words[count] ?? String(count);
export const assetHref = (slug, file) => `/assets/examples/${slug}/${file}`;
