import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SLIDE_TIER_RANGES } from "@tj/domain/documents";
import { withClose } from "./close";
import fixture from "./fixtures/pilot-v411-y2-greatfire.json" with { type: "json" };
import { PILOT_PACK_ID, PILOT_PACKS, pilotRequest } from "./pilot-pack";
import { type WriterStage, writerSchema } from "./schema";

/*
 * Pilot pack v4.11 (TEACH-110 part as): v4.10 with whole questions and 3-option hinges for the
 * young. A real Y2 Great Fire lesson under v4.10 ended its exit ticket on "Include wind." and
 * asked a 2-option hinge (ruling 147: Years 1 to 4 get 3 options). Schema and code are v4.10's,
 * so only one template line differs.
 */
type J = Record<string, any>;
const STAGES: readonly WriterStage[] = ["KS1", "KS2", "KS3-5"];
const KS = { KS1: "KS1", KS2: "KS2", "KS3-5": "KS3" } as const;
const dir = (v: string) => new URL(`./bundles/pilot-${v}-menu/`, import.meta.url);
const read = (v: string, name: string) => readFileSync(new URL(name, dir(v)), "utf8");

describe("pilot pack v4.11", () => {
  test("production runs v4.11", () => expect(PILOT_PACK_ID).toBe("v4.11"));

  for (const stage of STAGES) {
    const ks = KS[stage];

    test(`${ks}: the assembled text is the pinned snapshot`, () => {
      expect(PILOT_PACKS["v4.11"].system[ks]).toBe(read("v4.11", `system-${ks}.snapshot.txt`));
    });

    test(`${ks}: the template is v4.10's with only the pupil-line rule changed`, () => {
      const old = read("v4.10", `system-${ks}.template.txt`).split("\n");
      const now = read("v4.11", `system-${ks}.template.txt`).split("\n");
      expect(now).toHaveLength(old.length);
      const at = now.findIndex((l, i) => l !== old[i]);
      expect(now.filter((l, i) => l !== old[i])).toHaveLength(1);
      const line = now[at] as string;
      expect(line).toStartWith("Every line is written for the pupils who read it");
      // v4.10's line is kept whole: v4.11 only adds sentences to it.
      for (const s of (old[at] as string).split(". ")) {
        // Its "It names a partner" sentence now names its subject, after the new sentences.
        expect(line).toContain(
          s.replace(/^It names a partner/, "A question or task names a partner"),
        );
      }
      expect(line).toContain("This holds for the exit ticket's questions too.");
      expect(line).toContain(
        'A question never ends on a second, clipped command, such as "Explain."',
      );
      expect(line).toContain("An exit question that checks two objectives asks one whole question");
      expect(line).toContain(
        "A hinge has exactly the number of options its flow entry's size counts.",
      );
      expect(line.includes("A hinge has 3 options, each a short phrase")).toBe(ks === "KS1");
      expect(line.includes("In Years 3 and 4, a hinge has 3 options.")).toBe(ks === "KS2");
    });

    for (const [tier, range] of Object.entries(SLIDE_TIER_RANGES)) {
      test(`${ks} ${tier}: the request schema is v4.10's`, () => {
        const prod = writerSchema(stage, range);
        for (const exitTicketOnSlides of [true, false]) {
          const req = (v: "v4.10" | "v4.11") =>
            withClose(pilotRequest(v, stage, prod, (sc) => sc).schema, exitTicketOnSlides) as J;
          expect(req("v4.11")).toEqual(req("v4.10"));
        }
      });
    }
  }

  test("the paid check's Great Fire deck asks whole questions and 3-option hinges", () => {
    // gpt-6.1-sol, effort low, 26 Oct 2026, Y2 Great Fire Detailed under this pack (13 slides).
    // v4.10's real lesson wrote the exit question "Why replace wooden walls after the fire?
    // Include wind." and a 2-option hinge.
    const slides = [...fixture.slides, fixture.close] as J[];
    const questions = slides.flatMap((s) => [
      ...((s.items ?? []) as J[]).flatMap((i) =>
        typeof i.question === "string" ? [i.question] : [],
      ),
      ...(s.template === "hinge" ? [s.heading as string] : []),
    ]);
    expect(questions.length).toBeGreaterThan(4);
    // A clipped tail: a question, then a short sentence of at most 4 words that asks nothing.
    const clipped = questions.filter((q) => {
      const parts = q.split(/(?<=[.?!])\s+/);
      const last = parts[parts.length - 1] as string;
      return parts.length > 1 && !last.endsWith("?") && last.split(/\s+/).length <= 4;
    });
    expect(clipped).toEqual([]);
    const hinges = slides.filter((s) => s.template === "hinge");
    expect(hinges.length).toBeGreaterThan(0);
    for (const h of hinges) expect(h.options).toHaveLength(3);
    expect(fixture.close.template).toBe("exit-ticket");
    expect(3 + fixture.slides.length).toBe(13);
  });
});
