import { cp, rm, stat } from "node:fs/promises";

const web = new URL("../apps/web/dist/", import.meta.url);
// Require a completed Vite build: never silently produce a homepage-only application deploy.
await stat(new URL("index.html", web));
await rm(new URL("homepage/", web), { recursive: true, force: true });
await cp(new URL("./dist/", import.meta.url), new URL("homepage/", web), { recursive: true });
// Vercel serves this with status 404 for missing static homepage paths. Other app paths use SPA rewrite.
await cp(new URL("./dist/404.html", import.meta.url), new URL("404.html", web));
console.log("Staged homepage into apps/web/dist/homepage.");
