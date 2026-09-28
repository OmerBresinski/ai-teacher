// Build flags, read from argv so build.mjs, check.mjs and serve.mjs always agree. On Vercel they are
// resolved from the project's environment by `bun scripts/vercel-env.ts site exec …`.
const flag = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

// A build can be served at the domain root with --base=/ (dayback.app) or under a prefix.
const requested = flag("base") ?? "/homepage";
if (!/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?\/?$/.test(requested)) {
  throw new Error("The homepage base must be an absolute path, such as /homepage or /.");
}
export const base = requested.replace(/\/$/, "");

/** An absolute https origin (plus optional path) with no query or fragment and no trailing slash. */
function httpsUrl(value, what, example) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${what} must be absolute, such as ${example}.`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.search || parsed.hash) {
    throw new Error(`${what} must be an absolute https URL with no query or fragment.`);
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, "");
}

// The application the hero hands a topic to. The legacy /homepage copy staged into the app build
// passes its own origin (package.json `homepage:build`).
export const appUrl = httpsUrl(
  flag("app") ?? "https://teach.dayback.app",
  "The application URL",
  "https://teach.dayback.app",
);

// The public site every canonical, Open Graph URL and sitemap entry points at. Staging and local
// builds keep the production value: their canonical names the live page they stand in for.
export const siteUrl = httpsUrl(
  flag("site") ?? "https://dayback.app",
  "The site URL",
  "https://dayback.app",
);

// An example lesson whose assets are stand-ins is only emitted when this flag is passed.
export const allowProvisional = process.argv.includes("--allow-provisional");

// Search engines may index the output only when --index is passed, which the Vercel production
// build does only when SITE_INDEXING=1. Everything else (local, staging, the legacy /homepage copy)
// stays noindex. Stand-in examples are never indexable, and a prefixed build never is either.
export const indexable = process.argv.includes("--index");
if (indexable && allowProvisional) {
  throw new Error("--index cannot be combined with --allow-provisional: stand-ins stay noindex.");
}
if (indexable && base !== "") {
  throw new Error("--index needs --base=/: only the domain-root site is indexable.");
}
