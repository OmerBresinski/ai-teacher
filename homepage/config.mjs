// A build can also be served at the domain root with --base=/. No environment contract required.
const requested = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? "/homepage";
if (!/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?\/?$/.test(requested)) {
  throw new Error("The homepage base must be an absolute path, such as /homepage or /.");
}
export const base = requested.replace(/\/$/, "");
