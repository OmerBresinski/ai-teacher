import { useSyncExternalStore } from "react";

/**
 * A `localStorage`-backed enum preference shared across tabs and components.
 *
 * Same-tab writers announce through a `tj:<key>` window event (the `storage` event only fires in
 * *other* tabs), so every subscriber re-reads at once. Reads are cached per `key` until the next
 * announced write, so a render never touches `localStorage` (js-cache-storage).
 */
const cache = new Map<string, string | null>();

function read(key: string): string | null {
  if (cache.has(key)) return cache.get(key) ?? null;
  let value: string | null = null;
  try {
    value = localStorage.getItem(key);
  } catch {
    // Storage disabled: fall through to the default.
  }
  cache.set(key, value);
  return value;
}

function subscribe(key: string, onChange: () => void): () => void {
  const event = `tj:${key}`;
  const invalidate = () => {
    cache.delete(key);
    onChange();
  };
  const onStorage = (storageEvent: StorageEvent) => {
    // `key === null` is `localStorage.clear()` in another tab.
    if (storageEvent.key === key || storageEvent.key === null) invalidate();
  };
  window.addEventListener(event, invalidate);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(event, invalidate);
    window.removeEventListener("storage", onStorage);
  };
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences keep working for this tab through the cache below.
  }
  cache.set(key, value);
  window.dispatchEvent(new Event(`tj:${key}`));
}

export function usePreference<T extends string>(
  key: string,
  values: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    (onChange) => subscribe(key, onChange),
    () => {
      const stored = read(key);
      return values.includes(stored as T) ? (stored as T) : fallback;
    },
    () => fallback,
  );
  return [value, (next) => writePreference(key, next)];
}
