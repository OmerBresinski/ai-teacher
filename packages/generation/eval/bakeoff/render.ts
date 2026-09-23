/*
 * Placeholder rendering for the bake-off: `{{name}}` in a contestant's templates is replaced by
 * the item's text. A placeholder the task does not define is an error (the contestant misread the
 * brief); one used more than once is an error too (the brief says at most once); one left out is
 * simply not shown. Nothing else in the template is touched, so `{{` in prose survives only when
 * it is not a defined placeholder name.
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export interface Rendered {
  text: string;
  used: string[];
}

export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
}

export function renderTemplate(
  template: string,
  values: Record<string, string>,
  allowed: readonly string[],
): Rendered {
  const names = placeholdersIn(template);
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const [name, count] of counts) {
    if (!allowed.includes(name)) throw new Error(`unknown placeholder {{${name}}}`);
    if (count > 1) throw new Error(`placeholder {{${name}}} used ${count} times (at most once)`);
    if (!(name in values)) throw new Error(`no value for {{${name}}}`);
  }
  const text = template.replace(PLACEHOLDER, (_, name: string) => values[name] as string);
  return { text, used: [...counts.keys()] };
}

/** Both templates rendered; the system text may carry placeholders too (the brief allows it). */
export function renderPrompt(
  prompt: { system: string; user: string },
  values: Record<string, string>,
  allowed: readonly string[],
): { system: string; user: string; used: string[] } {
  const all = [...placeholdersIn(prompt.system), ...placeholdersIn(prompt.user)];
  const dupes = all.filter((n, i) => all.indexOf(n) !== i);
  if (dupes.length) throw new Error(`placeholder {{${dupes[0]}}} used in both system and user`);
  const system = renderTemplate(prompt.system, values, allowed);
  const user = renderTemplate(prompt.user, values, allowed);
  return { system: system.text, user: user.text, used: [...system.used, ...user.used] };
}
