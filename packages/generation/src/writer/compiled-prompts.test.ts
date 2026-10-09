import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { withActivities, withActivityMenu } from "./activities";
import { writerBundle } from "./bundle";
import { type Brief, contextBlock, fillTemplate, promptStage, pupilWordLimit } from "./fixes";
import { writerSchema } from "./schema";
import { writerSystem } from "./stage";

/*
 * #431 review: the writer's compiled prompts against origin/master db5996d0 (#438), by hash (sha256, 16
 * hex), for y1, y5, y11 and y12. Equal except the intended changes, each undone here to reach
 * master's hash:
 *  - systemActivities: the activity menu's pair line (prompt-engineer, fault 4);
 *  - pupilSystem: the pupil-objectives prompt (prompt-engineer, fault 1);
 *  - pupilUser: the word limit (min of the reading target and the room, fault 1).
 * system and schema, with and without activities, and the user turns (writer and objectives,
 * "Challenge: core" kept) are master's byte for byte.
 */
const sha = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);
const MASTER: Record<string, Record<string, string>> = {
  y1: {
    system: "ee117f26e928c9be",
    systemActivities: "9c853602c38bf791",
    schema: "b3cd59927b0a5886",
    schemaActivities: "9f56c20a601c466b",
    user: "9ffbb70ea5ae3a28",
    objectivesUser: "69e673f812b90d69",
    pupilSystem: "3d4f02f2e3abfca8",
    pupilUser: "60abf1cd2bf07067",
  },
  y5: {
    system: "c1f30ffd083653c3",
    systemActivities: "51d53bbfbe11d08c",
    schema: "2a8b1ce52c3499bb",
    schemaActivities: "5593824901b70364",
    user: "c26c5992e1db048e",
    objectivesUser: "5be0267edf610bfb",
    pupilSystem: "3d4f02f2e3abfca8",
    pupilUser: "dec15f411181bc89",
  },
  y11: {
    system: "facae247b8aaf45a",
    systemActivities: "4b7dcf7d41e56713",
    schema: "2e0b12966bc4cc7d",
    schemaActivities: "2001038ab241873e",
    user: "87d38790d45c179b",
    objectivesUser: "d327cf28aa903fbc",
    pupilSystem: "3d4f02f2e3abfca8",
    pupilUser: "981c12ef2f5ecb55",
  },
  y12: {
    system: "facae247b8aaf45a",
    systemActivities: "4b7dcf7d41e56713",
    schema: "2e0b12966bc4cc7d",
    schemaActivities: "2001038ab241873e",
    user: "94ec9f20b327b8dc",
    objectivesUser: "ee0b24a8d6e1e272",
    pupilSystem: "3d4f02f2e3abfca8",
    pupilUser: "683493fc5a351caa",
  },
};
const OLD_PAIR_LINE =
  "- pair: match each picture to its label, for names or terms just taught; every card has a picture. Fits: {fits.pair}.";
const NEW_PAIR_LINE =
  "- pair: match each picture to the label that names it, for names or terms just taught; every card has a picture, and the instruction asks for that match alone. Fits: {fits.pair}.";
/** The pair line up to its Fits (the compiled menu fills the Fits by stage). */
const head = (l: string) => l.slice(0, l.indexOf(" Fits:"));
const OLD_PAIR = head(OLD_PAIR_LINE);
const NEW_PAIR = head(NEW_PAIR_LINE);
/** Master's word limit: the room alone (floor(chars / 6)) for 2 objectives. */
const MASTER_LIMIT: Record<string, number> = { ks1: 20, ks2: 24, ks4: 37, ks5: 37 };

const brief = (topic: string, subject: string, year: number, keyStage: Brief["keyStage"]) =>
  ({
    id: `y${year}`,
    topic,
    subject,
    yearGroup: `Year ${year}`,
    year,
    keyStage,
    challenge: "core",
    theme: "chalk",
    readingLevel: `Year ${year}`,
    language: "en-GB",
    durationMin: 60,
    exitTicketOnSlides: false,
    tier: "standard",
    slides: { min: 9, max: 12 },
  }) as Brief;
const LESSONS: Record<string, Brief> = {
  y1: brief("Animals and their young", "Science", 1, "ks1"),
  y5: brief("Fractions of amounts", "Maths", 5, "ks2"),
  y11: brief("Rates of reaction", "Chemistry", 11, "ks4"),
  y12: brief("The multi-store model of memory", "Psychology", 12, "ks5"),
};
const OBJ = [
  "Name the young of common animals",
  "Describe how young animals are like their parents",
];
const P = writerBundle();

describe("compiled prompts against master (options off)", () => {
  for (const [k, b] of Object.entries(LESSONS)) {
    const st = promptStage(b.keyStage);
    const m = MASTER[k] as Record<string, string>;
    const schema = writerSchema(st, b.slides);
    test(`${k}: system and schema are master's`, () => {
      expect(sha(writerSystem(b))).toBe(m.system as string);
      expect(sha(JSON.stringify(schema))).toBe(m.schema as string);
      expect(sha(JSON.stringify(withActivities(schema, st)))).toBe(m.schemaActivities as string);
    });
    test(`${k}: the intended changes, each undone, give master's`, () => {
      const act = withActivityMenu(writerSystem(b), st);
      expect(sha(act)).not.toBe(m.systemActivities as string);
      expect(sha(act.replace(NEW_PAIR, OLD_PAIR))).toBe(m.systemActivities as string);
      const user = contextBlock(
        b,
        OBJ.map((t) => ({ teacher: t, pupil: "" })),
        P.user,
      );
      expect(user).toContain("\nChallenge: core\n");
      expect(sha(user)).toBe(m.user as string);
      const objUser = fillTemplate(P.objectivesUser, b);
      expect(sha(objUser)).toBe(m.objectivesUser as string);
      expect(sha(P.pupilObjectives)).not.toBe(m.pupilSystem as string);
      const pupil = (n: number) =>
        fillTemplate(P.pupilObjectivesUser, b, {
          objectives: OBJ.map((t) => ({ teacher: t, pupil: t })),
          maxWords: n,
        });
      expect(sha(pupil(pupilWordLimit(b.keyStage, 2)))).not.toBe(m.pupilUser as string);
      expect(sha(pupil(MASTER_LIMIT[b.keyStage] as number))).toBe(m.pupilUser as string);
    });
  }
});

describe("support and stretch user turns (as master: the level word only)", () => {
  for (const level of ["support", "stretch"] as const)
    test(`${level}: "Challenge: ${level}" where core has "Challenge: core", nothing else changed`, () => {
      for (const b of Object.values(LESSONS)) {
        const objs = OBJ.map((t) => ({ teacher: t, pupil: "" }));
        const core = contextBlock(b, objs, P.user);
        const u = contextBlock({ ...b, challenge: level }, objs, P.user);
        expect(u).toContain(`\nReading level: Year ${b.year}\nChallenge: ${level}\nLanguage:`);
        expect(u.replace(`Challenge: ${level}\n`, "Challenge: core\n")).toBe(core);
        const o = fillTemplate(P.objectivesUser, { ...b, challenge: level });
        expect(o.replace(`Challenge: ${level}\n`, "Challenge: core\n")).toBe(
          fillTemplate(P.objectivesUser, b),
        );
      }
    });
});
