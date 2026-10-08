// Arm "locale" $0 compile: the writer, objectives, objective-repair and picture-director requests as
// sent (after fillTemplate and localise) for a brief, in one arm. `bun lab/bakeoff/ab/localecompile.ts`
// writes the NZ and UK seasons briefs (locale and base4) to BAKEOFF/ab/arms3/locale/compiled/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pictureDirectorPrompt } from "../../../packages/generation/src/prompts/picture-director";
import { armT } from "../arm-t";
import { type Brief, contextBlock, fillTemplate } from "../harness";
import { locale, localise, setLocale } from "../locale";
import { AB, type AbArm, abShared, setAbArm } from "./arms";

export const NZ_UK = `${AB}/runs/nz-uk/T`;
export type Objectives = { teacher: string; pupil: string }[];

/** Each prompt the brief's lesson sends, system then user, as the model receives it. */
export function compileLocale(
  arm: AbArm,
  brief: Brief,
  objectives: Objectives,
): Record<"writer" | "objectives" | "objective-repair" | "director", string> {
  setAbArm(arm);
  setLocale(brief.locale);
  try {
    const shared = abShared() as string;
    const read = (f: string) => readFileSync(`${shared}/${f}`, "utf8");
    const p = armT.prompt(brief as never) as { system: string };
    const dir = pictureDirectorPrompt({
      yearGroup: brief.yearGroup,
      subject: brief.subject,
      title: brief.topic,
      country: locale().country,
      heading: "Autumn and winter",
      text: "Leaves fall. Days get shorter.",
      point: "Trees change through the seasons.",
      request: "a tree in a park in autumn",
      mustShow: [],
      aspect: 1.5,
      style: "photo",
    } as never);
    const req = (system: string, user: string) =>
      `=== system\n${localise(system)}\n=== user\n${localise(user)}\n`;
    return {
      writer: req(p.system, contextBlock(brief, objectives)),
      objectives: req(read("objectives.txt"), fillTemplate(read("objectives-user.txt"), brief)),
      "objective-repair": req(read("objective-repair.txt"), "(the lesson, as the run sends it)"),
      director: req(`${dir.system}\n\n=== batch system\n${read("director-batch.txt")}`, dir.user),
    };
  } finally {
    setAbArm(undefined);
    setLocale(undefined);
  }
}

export const nzUkBrief = (c: "nz" | "uk"): Brief =>
  JSON.parse(readFileSync(`${NZ_UK}/y1-science-seasons-${c}/brief.json`, "utf8"));
/** The UK run's approved objectives (they never name a country), for both briefs' writer turn. */
export const ukObjectives = (): Objectives =>
  JSON.parse(readFileSync(`${NZ_UK}/y1-science-seasons-uk/objectives.json`, "utf8")).objectives;

if (import.meta.main) {
  const out = `${AB}/arms3/locale/compiled`;
  for (const arm of ["locale", "base4"] as const)
    for (const c of ["nz", "uk"] as const) {
      mkdirSync(`${out}/${arm}/${c}`, { recursive: true });
      for (const [k, v] of Object.entries(compileLocale(arm, nzUkBrief(c), ukObjectives())))
        writeFileSync(`${out}/${arm}/${c}/${k}.txt`, v);
    }
  console.log(
    `wrote ${out}/{locale,base4}/{nz,uk}/{writer,objectives,objective-repair,director}.txt`,
  );
}
