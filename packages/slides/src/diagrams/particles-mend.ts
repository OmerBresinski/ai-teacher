import { LIMITS } from "./limits";

type Rec = Record<string, unknown>;

const COUNT_MAX = 20;
const COUNT_MIN = 2;
const EXTRA_MAX = 12;
const DANGLING =
  /^(a|an|the|of|in|on|at|to|for|and|or|but|with|by|from|into|than|as|is|are|per|same)$/i;

/**
 * Register diagrams-11 (base4f-p123-1 y11 s9): a particles spec that missed one of its own limits
 * by a little faulted as a whole, and after two drawer tries the figure was dropped. The parse
 * mends it first, so the picture is kept:
 * - counts past 20 (or extras past 12) are scaled down together, so the panels keep their order
 *   and roughly their ratio (25 vs 10 becomes 20 vs 8);
 * - a note past what the long-label stretch can draw whole (`stretch` times its limit) is cut at
 *   the last whole word within its limit (a note within the stretch is left to be drawn whole);
 * - a key is a pair: past two names it keeps the first two, with fewer it is left out.
 * Anything else still faults. A spec that needs none of this (every spec that parses today) is
 * returned as the same object; the spec as sent is never changed. It never calls the parser, so
 * there is nothing to loop on (the parked version re-parsed whenever `mended !== spec`, and a NaN
 * spec is never `===` itself, so it recursed without end).
 */
export function mendParticles(spec: unknown, stretch: number): unknown {
  if (!spec || typeof spec !== "object" || (spec as Rec).kind !== "particles") return spec;
  const s = spec as Rec;
  const out: Rec = { ...s };
  let changed = false;

  const max = LIMITS.particles.noteChars;
  if (Array.isArray(s.notes) && s.notes.some((t) => typeof t === "string" && overNote(t))) {
    out.notes = s.notes.map((t) => (typeof t === "string" && overNote(t) ? cutNote(t) : t));
    changed = true;
  }
  function overNote(t: string) {
    return t.trim().length > Math.floor(max * stretch);
  }
  function cutNote(t: string) {
    const head = t.trim().slice(0, max + 1);
    const cut = head.lastIndexOf(" ");
    let words = (cut > 0 ? head.slice(0, cut) : head.slice(0, max)).split(/\s+/);
    // never end on a word that leads into the cut part ("More particles in the")
    while (words.length > 1 && DANGLING.test(words[words.length - 1] ?? ""))
      words = words.slice(0, -1);
    return words.join(" ").replace(/[\s,;:–-]+$/, "");
  }

  if (Array.isArray(s.panels)) {
    const panels = s.panels.map((p) => (p && typeof p === "object" ? { ...(p as Rec) } : p));
    const scale = (field: string, cap: number, floor: number) => {
      let top = 0;
      for (const p of panels) {
        const v = (p as Rec | undefined)?.[field];
        if (typeof v === "number" && Number.isFinite(v) && v > top) top = v;
      }
      if (top <= cap) return false;
      for (const p of panels) {
        const v = (p as Rec | undefined)?.[field];
        if (typeof v === "number" && Number.isFinite(v))
          (p as Rec)[field] = Math.max(floor, Math.round((v * cap) / top));
      }
      return true;
    };
    const counts = scale("count", COUNT_MAX, COUNT_MIN);
    const extras = scale("extra", EXTRA_MAX, 0);
    if (counts || extras) {
      out.panels = panels;
      changed = true;
    }
  }

  if (Array.isArray(s.key) && s.key.length !== 2) {
    if (s.key.length > 2) out.key = s.key.slice(0, 2);
    else delete out.key;
    changed = true;
  }
  return changed ? out : spec;
}
