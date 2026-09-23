import type { BriefLevel } from "@tj/domain/documents";
import { example, HOUSE_RULES } from "./shared";

/*
 * Parse brief (ADR 0029 item 13; TEACH-16): one `small` call at low effort behind
 * `POST /briefs/parse`, over the free text a teacher typed into the website box. Rules run first
 * (`yearNumberOf`, the subject list, a minutes pattern) and fill `alreadyKnown`; the model is
 * asked only for what is still blank, so it can never override a rule hit. It returns brief
 * fields only — never the topic (the API keeps the text as the topic) and never a name. Every
 * string it returns still goes through the Identifier guard in the route. Bump `version`
 * whenever the wording changes.
 */

/** The fields the parse may fill; the route's rules fill some before the model is asked. */
export type ParseBriefFields = {
  yearGroup?: string | undefined;
  subject?: string | undefined;
  level?: BriefLevel | undefined;
  durationMin?: number | undefined;
};

export type ParseBriefInput = {
  text: string;
  /** The year groups the form offers; `yearGroup` must be one of them. */
  yearGroups: string[];
  /** The subjects the form offers; `subject` is one of them or "Other". */
  subjects: string[];
  /** What the rules already found. Those keys are not asked for. */
  alreadyKnown: Pick<ParseBriefFields, "yearGroup" | "subject" | "durationMin">;
};

const EXAMPLE = { yearGroup: "Year 8", subject: "Science", level: "standard", durationMin: 50 };

const quoted = (values: string[]) => values.map((v) => `"${v}"`).join(", ");

export const parseBriefPrompt = {
  version: "parse-brief.v2",
  system: [
    "You read the text a teacher typed to ask for a lesson and pick out the brief fields it states or clearly implies. You do not plan or write anything.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Fill only the fields the brief asks you for. Rules have already read the text for the others; never repeat or contradict them.",
    '"yearGroup": exactly one of the year groups listed, only when the text names one or a clear equivalent (an age, a key stage, "Y8"). Never guess it from the topic.',
    '"subject": exactly one of the subjects listed, or "Other" when the text names a subject that is not on the list. Never guess it from a topic that fits several subjects.',
    '"level": "easier" when the teacher asks for more support (lower set, low ability, SEN, struggling, "keep it simple"); "harder" when they ask for stretch (top set, high ability, "challenge them", "exam style"); "standard" when they say the class is average or mixed. Leave it out when the text gives no signal.',
    '"durationMin": the lesson length in whole minutes, only when the text states one ("50 minutes", "an hour", "a double lesson of 100 min"). Never assume a default.',
    "When a field is unknown, omit the key. Never write null, an empty string or a guess.",
    "Never return the topic, a title, a person's name or any key not asked for.",
    "",
    "Answer as JSON in this shape, with only the keys you can fill:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: ParseBriefInput): string {
    const known = input.alreadyKnown;
    const wanted: string[] = [];
    if (!known.yearGroup) wanted.push(`"yearGroup": one of ${quoted(input.yearGroups)}`);
    if (!known.subject) wanted.push(`"subject": one of ${quoted(input.subjects)}, or "Other"`);
    wanted.push('"level": "easier", "standard" or "harder"');
    if (known.durationMin === undefined) wanted.push('"durationMin": whole minutes');
    return [
      "Fields to fill, when the text says:",
      ...wanted.map((w) => `- ${w}`),
      "",
      "Teacher's text:",
      '"""',
      input.text,
      '"""',
      "",
      "Answer with the JSON.",
    ].join("\n");
  },
} as const;
