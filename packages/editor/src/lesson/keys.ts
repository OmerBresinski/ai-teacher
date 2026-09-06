/**
 * Keyboard bindings without tinykeys: the same `"$mod+Shift+z"` strings TeachDeck used (so the
 * help sheet and the handlers share one vocabulary), matched by hand against a `KeyboardEvent`.
 * Modifiers are strict — `"ArrowUp"` does not match while Shift is held, so the plain and the
 * Shift nudge never both fire.
 */

/** `navigator.platform` is deprecated; prefer UA-CH and keep it as the fallback. */
export const IS_MAC: boolean = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = ua?.platform || navigator.platform || "";
  return /mac|ipod|iphone|ipad/i.test(platform);
})();

/** Parts that name a physical key (`event.code`) rather than a character (`event.key`). */
const CODE_PARTS = new Set(["BracketLeft", "BracketRight", "Equal", "Minus", "Space", "Semicolon"]);

export type ParsedBinding = {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
  code: boolean;
};

export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.split("+");
  const key = parts[parts.length - 1] ?? "";
  return {
    mod: parts.includes("$mod"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    key,
    code: CODE_PARTS.has(key),
  };
}

/** Does the event match the binding, modifiers included (`$mod` is ⌘ on a Mac, Ctrl elsewhere)? */
export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const b = parseBinding(binding);
  if ((e.metaKey || e.ctrlKey) !== b.mod) return false;
  if (e.altKey !== b.alt) return false;
  // `?` and `+` are only reachable through Shift on most layouts, so a bare-character binding
  // ignores the shift state; a named key (`ArrowUp`, `z`) is strict about it.
  const symbol = b.key.length === 1 && !/^[a-z0-9]$/i.test(b.key);
  if (!symbol && e.shiftKey !== b.shift) return false;
  if (b.code) return e.code === b.key || (b.key === "Space" && e.key === " ");
  return b.key.length === 1 ? e.key.toLowerCase() === b.key.toLowerCase() : e.key === b.key;
}

/** The first binding in the map that matches, so a handler can switch on it. */
export function findBinding<K extends string>(e: KeyboardEvent, bindings: readonly K[]): K | null {
  return bindings.find((b) => matchesBinding(e, b)) ?? null;
}

/** `'$mod+Shift+BracketRight'` → `['⌘', '⇧', ']']` for the help sheet. */
export function formatShortcut(keys: string): string[] {
  return keys.split("+").map((part) => {
    switch (part) {
      case "$mod":
        return IS_MAC ? "⌘" : "Ctrl";
      case "Shift":
        return "⇧";
      case "Alt":
        return IS_MAC ? "⌥" : "Alt";
      case "BracketRight":
        return "]";
      case "BracketLeft":
        return "[";
      case "Equal":
        return "=";
      case "Minus":
        return "-";
      case "Semicolon":
        return ";";
      case "ArrowLeft":
        return "←";
      case "ArrowRight":
        return "→";
      case "ArrowUp":
        return "↑";
      case "ArrowDown":
        return "↓";
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });
}

/** `'$mod+Shift+z'` → `'⌘⇧Z'`, for a tooltip or a Kbd. */
export const hint = (keys: string): string => formatShortcut(keys).join("");

/** True when the key event started in something that types. Escape is the caller's exception. */
export function isInTextField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[contenteditable="true"],[contenteditable=""],input,select,textarea') !== null
  );
}
