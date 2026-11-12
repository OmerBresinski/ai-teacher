/*
 * R3 (CRITIQUE-2, 12 Nov: Y5 Practice "A 11 m ribbon"): "a" or "an" before a number written in
 * digits follows how the number is read aloud, not its first letter. Numbers read with a vowel
 * sound: 8 and every number whose spoken form starts "eight" (8, 80-89, 800-899, 8,000...), 11 and
 * 18 ("eleven", "eighteen"), and 11 or 18 thousand / million (11,000, 18,500). Everything else
 * (1, 5, 100, 1,100...) takes "a". A code fix on sheet text, beside the prompt rule the prompt
 * engineer owns (FOR-V4.md), so a sheet never ships the slip whatever the model writes.
 */

/** Whether a number written in digits is read with a vowel sound first ("eight", "eleven", "eighteen"). */
export function readsWithVowel(digits: string): boolean {
  const n = digits.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(n)) return false;
  const whole = n.split(".")[0] as string;
  if (whole.startsWith("8")) return true;
  // The group read first: "11" in 11,000 and 11000, "1" in 1,100 and 1100.
  const lead = whole.length % 3 === 0 ? whole.slice(0, 3) : whole.slice(0, whole.length % 3);
  return lead === "11" || lead === "18";
}

const ARTICLE_BEFORE_NUMBER = /\b(a|an|A|An|AN)(\s+)(\d[\d,]*(?:\.\d+)?)/g;

/** `text` with "a" / "an" before each number in digits matched to how the number is read. */
export function fixNumberArticles(text: string): string {
  return text.replace(ARTICLE_BEFORE_NUMBER, (whole, art: string, gap: string, num: string) => {
    const want = readsWithVowel(num) ? "an" : "a";
    if (art.toLowerCase() === want) return whole;
    const cased =
      art[0] === art[0]?.toUpperCase() ? `${want[0]?.toUpperCase()}${want.slice(1)}` : want;
    return `${cased}${gap}${num}`;
  });
}
