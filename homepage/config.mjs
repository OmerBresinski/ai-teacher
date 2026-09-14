// A build can also be served at the domain root with --base=/. No environment contract required.
const requested = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "/homepage";
if (!/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?\/?$/.test(requested)) {
  throw new Error("The homepage base must be an absolute path, such as /homepage or /.");
}
export const base = requested.replace(/\/$/, "");

// The application the hero hands a topic to. Overridable with --app= for a staging origin.
const requestedApp = process.argv.find((arg) => arg.startsWith("--app="))?.slice(6);
const appCandidate = requestedApp ?? "https://app.bresinski.org";
let appParsed;
try {
  appParsed = new URL(appCandidate);
} catch {
  throw new Error("The application URL must be absolute, such as https://app.bresinski.org.");
}
if (appParsed.protocol !== "https:" || !appParsed.hostname || appParsed.search || appParsed.hash) {
  throw new Error("The application URL must be an absolute https URL with no query or fragment.");
}
export const appUrl = appParsed.origin + appParsed.pathname.replace(/\/$/, "");

// An example lesson whose assets are stand-ins is only emitted when this flag is passed.
export const allowProvisional = process.argv.includes("--allow-provisional");
