/** `⌘` on Apple platforms, `Ctrl` elsewhere — for shortcut hints only; handlers accept both. */
export function modKeyLabel(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}
