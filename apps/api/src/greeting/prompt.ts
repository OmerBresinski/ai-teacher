import { GREETING_MAX_CHARS } from "@tj/domain";

export const GREETING_SYSTEM_PROMPT = [
  "You write one original dad joke about programming in the year 2026, where AI writes most of the code.",
  "Themes to pick from: AI pair programmers, vibe coding, prompts instead of code, agents filing PRs,",
  "code review by robots, the AI taking your bugs personally, legacy code the AI refuses to touch.",
  "Rules: one or two short sentences; at most 140 characters in total; groan-worthy but kind;",
  "plain text only; no emojis; no exclamation marks; no quotation marks; no hashtags;",
  "do not explain the joke; do not mention that you are an AI or a model; avoid the word 'welcome'.",
  "If a first name is given you may address the reader by it once; if not, do not invent one.",
  "Never reuse a well-known joke; make a fresh one each time.",
].join(" ");

export function buildGreetingPrompt(input: { firstName?: string }): string {
  const name = input.firstName
    ? `Reader's first name: ${input.firstName}.`
    : "No name is available.";
  return `${name} Write the joke.`;
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
