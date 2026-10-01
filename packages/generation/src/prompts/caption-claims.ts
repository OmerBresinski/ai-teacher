import { example } from "./shared";

/*
 * Plan-write gates (round J): what a photo slide says about its photograph, checked as factual claims
 * against the photograph's own source record (Commons title, description, categories and, when the
 * page gives them, the coordinates it was taken at; a Pexels photo's alt). The name gate
 * (`namesNotShown`) catches a place the source does not name; this catches a claim about a place it
 * does name (I1a y5 s8: the Severn floodplain at Caersws captioned as the lower course; Caersws is on
 * the upper course). One call per lesson over its photo slides, on the checker's model. Every claim
 * is listed with a verdict, so a quick empty answer is not a pass. Bump the version on any change.
 */
export const CAPTION_CLAIMS_VERSION = "caption-claims.v1";

export type CaptionClaimsInput = {
  topic: string;
  slides: { number: number; text: string; source: string }[];
};

const EXAMPLE = {
  claims: [
    {
      slide: 5,
      quote: "the harbour at the mouth of the river",
      supported: false,
      why: "The source names the harbour and the town, not where it lies on the river.",
    },
  ],
};

const SYSTEM = [
  "You check what the photo slides of a lesson say about their photographs. For each slide you are given its text and the photograph's source record: the file's title and description, and where it was taken when that is known.",
  "",
  "List every claim the text makes about the photograph: what it shows; where it was taken; which part of a river, coast, landform or site it is (upper, middle or lower course, source, mouth); what it is near; a date or period; a direction or position. A teaching sentence that does not speak about the photograph is not a claim about it.",
  "A claim is supported only when the source record states it, or when the place the record names (or its coordinates) is well known to have it. It is not supported when the record does not say it and the place does not have it, or when you are unsure.",
  "For each claim give the slide number; quote, the claim's words copied exactly from the text; supported, true or false; and why: for an unsupported claim, what the record does support, in one sentence.",
  "",
  "Answer as JSON in exactly this shape:",
  example(EXAMPLE),
].join("\n");

export function captionClaimsPrompt(input: CaptionClaimsInput): { system: string; user: string } {
  return {
    system: SYSTEM,
    user: [
      `Topic: ${input.topic}`,
      ...input.slides.flatMap((s) => [
        "",
        `Slide ${s.number}`,
        `Text: ${s.text}`,
        `Source record: ${s.source}`,
      ]),
    ].join("\n"),
  };
}
