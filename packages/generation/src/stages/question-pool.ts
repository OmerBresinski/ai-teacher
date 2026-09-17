import type { FactQuestion, LessonFacts } from "@tj/domain/documents";

/*
 * The question pool (Generation quality §3; ADR 0030 item 2): who may use which question stem.
 * Pure over `facts.questions` and the outline's `factRefs`, so the lesson pipeline (Generate,
 * slides only) and the worksheet job (TEACH-14) compute the same split from the same facts —
 * neither needs the other to have run.
 */

/**
 * Who may use which question stem: a stem the plan gave to one outline entry is reserved from
 * every other slide and from the sheet; the sheet's pool is the `worksheet | any` questions, and
 * its stems are reserved from the slides. `any` is the one tag that leaves a stem open to both.
 */
export function stemPlan(facts: LessonFacts): {
  pool: FactQuestion[];
  reservedFor: (index: number) => string[];
  reservedForWorksheet: string[];
} {
  const byId = new Map(facts.questions.map((q) => [q.id, q]));
  const owner = new Map<string, number>();
  facts.outline.forEach((entry, i) => {
    for (const ref of entry.factRefs) if (byId.has(ref) && !owner.has(ref)) owner.set(ref, i);
  });
  // A `worksheet` question an outline entry claims is that slide's (TEACH-244: the sheet had
  // paraphrased one the plan gave the exit ticket); only `any` stays open to both.
  const pool = facts.questions.filter(
    (q) => (q.use === "worksheet" || q.use === "any") && !(owner.has(q.id) && q.use !== "any"),
  );
  const mine = (index: number) => new Set(facts.outline[index]?.factRefs ?? []);
  const reservedFor = (index: number) => {
    const own = mine(index);
    return facts.questions
      .filter((q) => {
        if (own.has(q.id)) return false;
        const o = owner.get(q.id);
        if (o !== undefined && o !== index) return true;
        return o === undefined && q.use === "worksheet";
      })
      .map((q) => q.stem);
  };
  const reservedForWorksheet = facts.questions
    .filter((q) => q.use === "slide" || q.use === "exit" || (owner.has(q.id) && q.use !== "any"))
    .map((q) => q.stem);
  return { pool, reservedFor, reservedForWorksheet };
}
