import type { DocumentSummary } from "@/mocks/library-schema";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function relativeTime(iso: string, now: number | Date = Date.now()): string {
  const elapsed = Math.max(0, new Date(now).getTime() - Date.parse(iso));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return DATE_FORMAT.format(new Date(iso));
}

export function absoluteTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}

export function sizeOf(document: Pick<DocumentSummary, "count" | "kind">): string {
  const noun = document.kind === "lesson" ? "slide" : "block";
  return `${document.count} ${noun}${document.count === 1 ? "" : "s"}`;
}

export function yearAndSubject(document: Pick<DocumentSummary, "yearGroup" | "subject">): string {
  return [document.yearGroup, document.subject].filter(Boolean).join(" ");
}
