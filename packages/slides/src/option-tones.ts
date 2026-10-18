import type { Theme } from "@tj/domain/documents";

/*
 * Apart from `themes.ts` so only the templates load these: the lazy layout kit (TEACH-205 part b)
 * reaches the templates, and whatever they use from a module the lesson pages load stays in those
 * pages' chunks.
 */

/**
 * Hinge option colours (UX ruling 203, P8; Chalkie's teal, mustard, pink and black squares): four
 * tokens per theme, one per option letter, in order. Each is clear of the others and of the
 * theme's correct and incorrect hues (the reveal's ring), at 3:1 or better on the option card,
 * with a letter in white or near-black at 4.5:1 (`hinge-colours.test.ts`).
 */
export const OPTION_TONES: Record<string, readonly [string, string, string, string]> = {
  chalk: ["#A94A18", "#4A5D8C", "#0E6B78", "#B0306A"],
  playground: ["#6532BE", "#855000", "#0E6B78", "#B0306A"],
  crayon: ["#A31F2E", "#805000", "#1A52A8", "#B0306A"],
  splash: ["#0A5CA2", "#7E5600", "#B8175A", "#5B3FA0"],
  treehouse: ["#0E6B78", "#7E5A0A", "#B0306A", "#5B3FA0"],
  "reading-room": ["#2C5A4D", "#7C5810", "#B0306A", "#5B3FA0"],
  studio: ["#0B6E86", "#7A580A", "#6D35D6", "#B0306A"],
  "exam-hall": ["#1B3A8C", "#78580C", "#B0306A", "#5B3FA0"],
  "night-lab": ["#F2B551", "#D083A6", "#9D8CC6", "#ECEDEF"],
  beacon: ["#0A46C8", "#7A5200", "#0E6B78", "#B0306A"],
  paper: ["#A94A18", "#4A5D8C", "#0E6B78", "#B0306A"],
  // Round 5 themes (TEACH-215 part c): tokens.json cat-1..4-ink.
  poster: ["#A8112D", "#014580", "#7A5805", "#065650"],
  storytime: ["#A41940", "#014580", "#7A5805", "#005553"],
  scrapbook: ["#9C2A44", "#014580", "#7A5805", "#055452"],
  calm: ["#792235", "#01305C", "#604501", "#003D3B"],
  geometric: ["#9C2A44", "#014580", "#7A5805", "#055452"],
  // The darks' hinge golds (round 5 themes5.css --opt-1..4, TEACH-215 part i).
  "dark-slate": ["#9DBBD0", "#D3BE96", "#B9A7D2", "#E4E7EB"],
  "dark-ember": ["#F2A08C", "#8CC7F2", "#E3C870", "#BBA8F0"],
};

/** A theme's option colours; one the table does not know takes Splash's, or Night Lab's when dark. */
export const optionTones = (t: Theme): readonly string[] =>
  OPTION_TONES[t.id] ?? (OPTION_TONES[t.dark ? "night-lab" : "splash"] as readonly string[]);
