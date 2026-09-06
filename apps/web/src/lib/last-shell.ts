import { useSyncExternalStore } from "react";

const SHELL_KEY = "tj:last-shell";
const SHELL_EVENT = "tj:last-shell";
const SHELL_HOME = "/";
const shellPaths = [/^\/$/, /^\/lessons$/, /^\/worksheets$/, /^\/series$/, /^\/series\/[^/]+$/];

function isShellPath(pathname: string): boolean {
  return shellPaths.some((pattern) => pattern.test(pathname));
}

/** Remember only pages rendered inside the library shell. */
export function rememberShell(pathname: string): void {
  if (!isShellPath(pathname)) return;
  try {
    sessionStorage.setItem(SHELL_KEY, pathname);
  } catch {
    // Back still has Home when storage is unavailable.
  }
  window.dispatchEvent(new Event(SHELL_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SHELL_KEY) onChange();
  };
  window.addEventListener(SHELL_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SHELL_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function readShellReturn(): string {
  try {
    const saved = sessionStorage.getItem(SHELL_KEY);
    return saved && isShellPath(saved) ? saved : SHELL_HOME;
  } catch {
    return SHELL_HOME;
  }
}

export function useShellReturn(): string {
  return useSyncExternalStore(subscribe, readShellReturn, () => SHELL_HOME);
}
