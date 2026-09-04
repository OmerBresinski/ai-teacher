import { GREETING_MAX_CHARS, type Weekday } from "@tj/domain";

export const GREETING_SYSTEM_PROMPT = [
  "You write a single short greeting for a school teacher who has just opened their lesson-planning tool.",
  "Rules: one sentence; at most 120 characters; warm and lightly witty; plain text only;",
  "no emojis; no exclamation marks; no quotation marks; do not mention being an AI or a model;",
  "do not give advice, instructions or questions; do not use the word 'welcome'.",
  "If a first name is given you may use it once; if not, do not invent one.",
].join(" ");

export function buildGreetingPrompt(input: { firstName?: string; weekday?: Weekday }): string {
  const name = input.firstName
    ? `Teacher's first name: ${input.firstName}.`
    : "No name is available.";
  const weekday = input.weekday ? `Today is ${input.weekday}.` : "Today is unknown.";
  return `${name} ${weekday} Write the greeting.`;
}

export function firstNameOf(fullName: string | null | undefined): string | undefined {
  const firstName = fullName?.trim().split(/\s+/)[0];
  return firstName && firstName.length <= 40 ? firstName : undefined;
}

export function sanitiseGreeting(raw: string): string | undefined {
  let text = raw.trim().replace(/\s+/g, " ");
  const first = text.at(0);
  const last = text.at(-1);
  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "“" && last === "”") ||
    (first === "‘" && last === "’")
  ) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/!+$/, ".");

  if (text.length > GREETING_MAX_CHARS) {
    const withinLimit = text.slice(0, GREETING_MAX_CHARS);
    const sentenceEnd = Math.max(withinLimit.lastIndexOf(". "), withinLimit.lastIndexOf("? "));
    text =
      sentenceEnd >= 0
        ? withinLimit.slice(0, sentenceEnd + 1)
        : `${withinLimit.slice(0, GREETING_MAX_CHARS - 1).trimEnd()}…`;
  }

  return text || undefined;
}
