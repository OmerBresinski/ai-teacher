import { WORD_SEARCH_MAX_SIZE, WORD_SEARCH_MIN_SIZE } from "@tj/domain/documents";
import { WORD_SEARCH_DEFAULT_SIZE } from "../model/worksheet-factories";

/**
 * Word search generation (TeachDeck `lib/worksheet/word-search.ts`; SPEC §9, Chalkie parity).
 *
 * Everything here is pure and deterministic: the same words, size, directions and seed always
 * build the same grid. That matters three times over — the editor, the hidden measuring column and
 * the print route each generate the grid independently, and all three have to agree letter for
 * letter or the page breaks and the answer key drift apart. "Shuffle" bumps the seed; nothing else
 * in the block ever changes on its own.
 *
 * The size bounds live in `@tj/domain/documents` (the schema enforces them); the default in
 * `model/worksheet-factories.ts` (the block factory uses it). Both are re-exported here.
 */
export { WORD_SEARCH_DEFAULT_SIZE, WORD_SEARCH_MAX_SIZE, WORD_SEARCH_MIN_SIZE };

export type WordSearchDirections = "across-down" | "all";

export type WordSearchPlacement = {
  /** The word as it sits in the grid: capitals, letters only. */
  word: string;
  row: number;
  col: number;
  /** Step from one letter to the next. */
  dRow: number;
  dCol: number;
};

export type WordSearchGrid = {
  size: number;
  /** `rows[row][col]`, every cell a single capital. */
  rows: string[][];
  placements: WordSearchPlacement[];
  /** Words the grid had no room for, in the order they were given. */
  unplaced: string[];
  /** Words left with no letters once accents and punctuation were stripped. */
  rejected: string[];
};

/** One run of cells that reads as a word: where it starts and which way it goes. */
export type WordSearchOccurrence = {
  row: number;
  col: number;
  dRow: number;
  dCol: number;
};

/** Across and down only, left to right and top to bottom, as on an infant sheet. */
const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
];

/** All eight: the four above plus diagonals, each also backwards. */
const EVERY_WAY: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [-1, 1],
];

export function directionVectors(directions: WordSearchDirections) {
  return directions === "all" ? EVERY_WAY : ORTHOGONAL;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** mulberry32: 32 bits of state, uniform enough for letters, four lines long. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `rows[row][col]`, or `""` off the grid — the callers below have already bounds-checked. */
const cellAt = (rows: string[][], row: number, col: number): string => rows[row]?.[col] ?? "";

const setCell = (rows: string[][], row: number, col: number, letter: string): void => {
  const line = rows[row];
  if (line) line[col] = letter;
};

export type NormalisedWords = {
  /** One entry per word that made it, in the order typed: what the teacher wrote and what goes into the grid. */
  entries: { raw: string; word: string }[];
  /** Words that had letters on screen but none left after the strip. */
  rejected: string[];
};

/**
 * The words as they go into the grid: capitals, letters only, no blanks and no repeats. A teacher
 * typing "water cycle, Water Cycle" means one word.
 *
 * Accents are decomposed first, so "café" hides as CAFE rather than CAF: in NFD the acute is a
 * separate combining mark the strip can drop on its own, where in the composed form the whole
 * letter is punctuation to the regex. A word that is nothing but marks or symbols ("???", "…")
 * comes back as rejected rather than disappearing without a word to the teacher.
 */
export function normaliseWordList(words: string[]): NormalisedWords {
  const entries: { raw: string; word: string }[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const typed = raw.trim();
    if (!typed) continue;
    const word = typed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase();
    if (!word) {
      rejected.push(typed);
      continue;
    }
    if (seen.has(word)) continue;
    seen.add(word);
    entries.push({ raw: typed, word });
  }
  return { entries, rejected };
}

/** Just the grid-ready words, for the callers that need nothing else. */
export function normaliseWords(words: string[]): string[] {
  return normaliseWordList(words).entries.map((entry) => entry.word);
}

/** The words as typed, joined for the toolbar field. */
export function wordsToText(words: string[]): string {
  return words.join(", ");
}

/** The toolbar field, split back into words. Commas and newlines both separate. */
export function textToWords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return WORD_SEARCH_DEFAULT_SIZE;
  return Math.min(WORD_SEARCH_MAX_SIZE, Math.max(WORD_SEARCH_MIN_SIZE, Math.round(size)));
}

/** Every start cell and direction a word of this length could take, in grid order. */
function candidates(
  length: number,
  size: number,
  directions: WordSearchDirections,
): WordSearchPlacement[] {
  const out: WordSearchPlacement[] = [];
  for (const [dRow, dCol] of directionVectors(directions)) {
    const lastRow = (length - 1) * dRow;
    const lastCol = (length - 1) * dCol;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const endRow = row + lastRow;
        const endCol = col + lastCol;
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;
        out.push({ word: "", row, col, dRow, dCol });
      }
    }
  }
  return out;
}

/** A word fits where every cell it needs is empty or already carries that letter. */
function fits(rows: string[][], word: string, at: WordSearchPlacement): boolean {
  for (let i = 0; i < word.length; i++) {
    const cell = cellAt(rows, at.row + at.dRow * i, at.col + at.dCol * i);
    if (cell !== "" && cell !== word[i]) return false;
  }
  return true;
}

/** Two runs are the same run when they cover the same cells, either way round. */
function runKey(occurrence: WordSearchOccurrence, length: number): string {
  const { row, col, dRow, dCol } = occurrence;
  const head = `${row},${col}`;
  const tail = `${row + dRow * (length - 1)},${col + dCol * (length - 1)}`;
  return head < tail ? `${head}|${tail}` : `${tail}|${head}`;
}

/**
 * Every run of cells that reads as this word, in any of the eight directions, whichever way the
 * grid was set to run. A pupil scanning a grid does not know which directions the generator
 * allowed, so a stray diagonal counts.
 *
 * A palindrome reads both ways along one run of cells; that is one occurrence, not two, so runs
 * are keyed on their end points.
 */
export function wordOccurrences(rows: string[][], word: string): WordSearchOccurrence[] {
  const size = rows.length;
  const out: WordSearchOccurrence[] = [];
  if (word.length === 0 || word.length > size) return out;
  const seen = new Set<string>();
  for (const [dRow, dCol] of EVERY_WAY) {
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const endRow = row + dRow * (word.length - 1);
        const endCol = col + dCol * (word.length - 1);
        if (endRow < 0 || endRow >= size || endCol < 0 || endCol >= size) continue;
        let hit = true;
        for (let i = 0; i < word.length && hit; i++) {
          if (cellAt(rows, row + dRow * i, col + dCol * i) !== word[i]) hit = false;
        }
        if (!hit) continue;
        const occurrence = { row, col, dRow, dCol };
        const key = runKey(occurrence, word.length);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(occurrence);
      }
    }
  }
  return out;
}

/** Where the word sits, or null. The first of `wordOccurrences`. */
export function findWord(
  grid: Pick<WordSearchGrid, "rows">,
  word: string,
): WordSearchOccurrence | null {
  return wordOccurrences(grid.rows, word)[0] ?? null;
}

/** Re-rolls allowed per word before the grid gives up on it. */
const MAX_REROLLS = 50;

/**
 * Fill the empty cells, then make sure no word reads twice.
 *
 * Random letters can spell a placed word a second time, and two placements crossing can spell a
 * third word between them. Either way the pupil finds a word where the answer key says there is
 * nothing, so after the fill every placed word is scanned for and any run that is not its own
 * placement has its fill cells re-rolled. Re-rolling can spell something else somewhere else, so
 * the whole list is re-checked until a pass finds nothing left to fix.
 *
 * Returns the words that are still ambiguous: a stray run made entirely of other words' letters
 * has no fill cell to re-roll, and a word that has burnt its fifty attempts is not worth another.
 * Those are reported as unplaced, because an unplaced word is a mistake the teacher can see and an
 * ambiguous grid is one the class finds instead.
 */
function fillAndDisambiguate(
  rows: string[][],
  placements: WordSearchPlacement[],
  random: () => number,
): string[] {
  const size = rows.length;
  const letter = () => ALPHABET[Math.floor(random() * 26)] ?? "A";

  const placed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isPlaced = (row: number, col: number) => placed[row]?.[col] === true;
  for (const placement of placements) {
    for (let i = 0; i < placement.word.length; i++) {
      const line = placed[placement.row + placement.dRow * i];
      if (line) line[placement.col + placement.dCol * i] = true;
    }
  }
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (cellAt(rows, row, col) === "") setCell(rows, row, col, letter());
    }
  }

  const ambiguous = new Set<string>();
  const attempts = new Map<string, number>();
  let guard = placements.length * MAX_REROLLS + placements.length + 1;
  while (guard-- > 0) {
    let touched = false;
    for (const placement of placements) {
      const word = placement.word;
      if (ambiguous.has(word)) continue;
      const own = runKey(placement, word.length);
      const strays = wordOccurrences(rows, word).filter((o) => runKey(o, word.length) !== own);
      if (strays.length === 0) continue;
      touched = true;
      const tried = attempts.get(word) ?? 0;
      if (tried >= MAX_REROLLS) {
        ambiguous.add(word);
        continue;
      }
      attempts.set(word, tried + 1);
      let rerolled = false;
      for (const stray of strays) {
        for (let i = 0; i < word.length; i++) {
          const row = stray.row + stray.dRow * i;
          const col = stray.col + stray.dCol * i;
          if (isPlaced(row, col)) continue;
          setCell(rows, row, col, letter());
          rerolled = true;
        }
      }
      if (!rerolled) ambiguous.add(word);
    }
    if (!touched) break;
  }
  return [...ambiguous];
}

const quoted = (words: string[]): string => {
  const list = words.map((word) => `“${word}”`);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
};

/** Every word too long for the grid, named together and as the teacher typed it. */
function overlongMessage(tooLong: { raw: string; word: string }[], side: number): string {
  const only = tooLong[0];
  if (tooLong.length === 1 && only) {
    return `“${only.raw}” is ${only.word.length} letters and the grid is ${side} across. Make the grid bigger or the word shorter.`;
  }
  return `${quoted(tooLong.map((entry) => entry.raw))} are longer than the grid, which is ${side} across. Make the grid bigger or the words shorter.`;
}

export type WordSearchOptions = {
  words: string[];
  size?: number;
  directions?: WordSearchDirections;
  seed?: number;
};

/**
 * Build the grid.
 *
 * Words go in longest first, which is what makes a dense grid possible: the long words claim the
 * few runs that can hold them before the short ones eat the space. Each word is tried against
 * every legal position in a seeded shuffle, so a placement is found whenever one exists and the
 * result is still the same on every machine.
 *
 * Throws when a word is longer than the grid side, because there is no grid to build and silently
 * dropping the word would print a puzzle with no answer. Every offender is named in the one
 * message: a teacher who shortens the first word only to be told about the second has been made
 * to fix it twice.
 */
export function generateWordSearch({
  words,
  size = WORD_SEARCH_DEFAULT_SIZE,
  directions = "across-down",
  seed = 1,
}: WordSearchOptions): WordSearchGrid {
  const side = clampSize(size);
  const { entries, rejected } = normaliseWordList(words);
  const list = entries.map((entry) => entry.word);

  const tooLong = entries.filter((entry) => entry.word.length > side);
  if (tooLong.length > 0) throw new Error(overlongMessage(tooLong, side));

  const random = prng(seed);
  const rows: string[][] = Array.from({ length: side }, () => new Array<string>(side).fill(""));
  const placements: WordSearchPlacement[] = [];
  const unplaced: string[] = [];

  // Longest first, ties in the order the teacher typed them.
  const order = list.map((word, index) => ({ word, index }));
  order.sort((a, b) => b.word.length - a.word.length || a.index - b.index);

  for (const { word } of order) {
    const options = candidates(word.length, side, directions);
    // Fisher-Yates on the seeded stream: every legal position, in a fixed random order, so the
    // search is exhaustive and reproducible.
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const a = options[i] as WordSearchPlacement;
      options[i] = options[j] as WordSearchPlacement;
      options[j] = a;
    }
    const spot = options.find((option) => fits(rows, word, option));
    if (!spot) {
      unplaced.push(word);
      continue;
    }
    for (let i = 0; i < word.length; i++) {
      setCell(rows, spot.row + spot.dRow * i, spot.col + spot.dCol * i, word[i] ?? "");
    }
    placements.push({ ...spot, word });
  }

  const ambiguous = new Set(fillAndDisambiguate(rows, placements, random));
  const found = placements.filter((placement) => !ambiguous.has(placement.word));
  for (const word of list) if (ambiguous.has(word)) unplaced.push(word);

  // Report placements in the order the words were typed, not the order they were packed: the
  // answer key reads down the word bank.
  found.sort((a, b) => list.indexOf(a.word) - list.indexOf(b.word));
  return {
    size: side,
    rows,
    placements: found,
    unplaced: unplaced.sort((a, b) => list.indexOf(a) - list.indexOf(b)),
    rejected,
  };
}

/** The settings a word search block carries, without importing the model. */
export type WordSearchSpec = {
  words: string[];
  size: number;
  directions: WordSearchDirections;
  seed: number;
};

export type WordSearchResult =
  | { grid: WordSearchGrid; error: null }
  | { grid: null; error: string };

/**
 * The grid, or the reason there isn't one. A word longer than the grid is a mistake the teacher
 * can see and fix, so it is reported on the sheet rather than thrown at the renderer, which would
 * take the whole page down.
 */
export function buildWordSearch(spec: WordSearchSpec): WordSearchResult {
  try {
    return { grid: generateWordSearch(spec), error: null };
  } catch (error) {
    return {
      grid: null,
      error: error instanceof Error ? error.message : "That word search could not be built.",
    };
  }
}

/**
 * The task line above the grid.
 *
 * With no word bank the pupil has nothing to check off, so the count is the whole instruction —
 * "Find every word" is unanswerable when the words are a secret. The count is the number of words
 * actually in the grid, never the number typed.
 */
export function wordSearchLead(
  directions: WordSearchDirections,
  hidden: number,
  showWordBank: boolean,
): string {
  const single = hidden === 1;
  const task = showWordBank
    ? single
      ? "Find the word."
      : "Find every word."
    : single
      ? "Find the hidden word."
      : `Find the ${hidden} hidden words.`;
  const how =
    directions === "all"
      ? single
        ? "It runs in any direction, including backwards."
        : "They run in any direction, including backwards."
      : single
        ? "It runs across and down."
        : "They run across and down.";
  return `${task} ${how}`;
}

export type WordSearchProblems = {
  /** Words longer than the grid side, as the teacher typed them. */
  overlong: string[];
  /**
   * Words short enough to fit that the packer still could not place, as the teacher typed them. A
   * crowded small grid does this to a short word: five three-letter words on a 10 by 10 can leave
   * the last one with nowhere to go. The fix is a different shuffle or a bigger grid, not a
   * shorter word, so it is counted apart from `overlong`.
   */
  unplaced: string[];
  /** Words that had no letters left after the strip, as the teacher typed them. */
  rejected: string[];
};

/**
 * What is wrong with this block, for the toolbar and for the Print gate. Both read the same
 * function, so the reason a teacher is shown beside the block is the reason Print is off.
 */
export function wordSearchProblems(spec: WordSearchSpec): WordSearchProblems {
  const { entries, rejected } = normaliseWordList(spec.words);
  const side = clampSize(spec.size);
  const tooLong = entries.filter((entry) => entry.word.length > side);
  // A word longer than the side means there is no grid to inspect, so nothing can be reported as
  // merely unplaced until that is fixed.
  if (tooLong.length > 0) {
    return { overlong: tooLong.map((entry) => entry.raw), unplaced: [], rejected };
  }
  const { grid } = buildWordSearch(spec);
  const raw = new Map(entries.map((entry) => [entry.word, entry.raw]));
  return {
    overlong: [],
    unplaced: grid ? grid.unplaced.map((word) => raw.get(word) ?? word) : [],
    rejected,
  };
}

/**
 * Why Print is off, in the teacher's terms. The two faults have two fixes: a word longer than the
 * grid needs a bigger grid or a shorter word, and a word that simply found no room needs another
 * shuffle or a bigger grid. Telling a teacher to shorten "RAT" because a 10 by 10 ran out of room
 * is wrong advice.
 */
export function unfittableMessage(overlong: number, unplaced = 0): string {
  const parts: string[] = [];
  if (overlong > 0) {
    parts.push(
      overlong === 1
        ? "1 word does not fit the grid. Make the grid bigger or the word shorter."
        : `${overlong} words do not fit the grid. Make the grid bigger or the words shorter.`,
    );
  }
  if (unplaced > 0) {
    parts.push(
      unplaced === 1
        ? "1 word could not be placed. Shuffle or make the grid bigger."
        : `${unplaced} words could not be placed. Shuffle or make the grid bigger.`,
    );
  }
  return parts.join(" ");
}

/** Said in the toolbar about a word that came out of the strip with no letters. */
export function rejectedMessage(words: string[]): string {
  return words.length === 1
    ? `${quoted(words)} has no letters to hide.`
    : `${quoted(words)} have no letters to hide.`;
}

/** True for every cell that carries a placed word, for the answer key. */
export function solutionMask(grid: WordSearchGrid): boolean[][] {
  const mask = Array.from({ length: grid.size }, () => new Array<boolean>(grid.size).fill(false));
  for (const placement of grid.placements) {
    for (let i = 0; i < placement.word.length; i++) {
      const line = mask[placement.row + placement.dRow * i];
      if (line) line[placement.col + placement.dCol * i] = true;
    }
  }
  return mask;
}
