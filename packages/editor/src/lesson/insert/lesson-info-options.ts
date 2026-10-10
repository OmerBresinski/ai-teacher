// The Info popover's choices, shared by its summary (static) and its edit fields (lazy).

/** Teachers pick a year group; the key stage (`ageBand`) is derived from it. */
export const YEAR_GROUPS = [
  "EYFS",
  ...Array.from({ length: 13 }, (_, i) => `Year ${i + 1}`),
] as const;

/** Languages a UK school sets work in, matching the New lesson dialog. */
export const LANGUAGES: { value: string; label: string }[] = [
  { value: "en-GB", label: "British English" },
  { value: "en-US", label: "American English" },
  { value: "cy", label: "Welsh" },
];
export const DEFAULT_LANGUAGE = "en-GB";
export const NOT_SET = "__none";

export const languageLabel = (value: string | undefined) =>
  LANGUAGES.find((l) => l.value === (value ?? DEFAULT_LANGUAGE))?.label ?? value ?? "";
