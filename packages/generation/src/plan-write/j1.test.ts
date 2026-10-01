import { describe, expect, test } from "bun:test";
import { coordinatesOf } from "@tj/images";
import { CAPTION_CLAIMS_VERSION, captionClaimsPrompt } from "../prompts/caption-claims";
import { fitWithRewrite, fitWritten } from "./fit";
import { type CaptionClaim, carriesClaim, unsupportedClaims, withoutClaim } from "./gates";

/** I1a y9 s4: a heading the writer twice left on two lines pushed the body into the footer on chalk. */
const y9s4 = {
  heading: "Ruhr occupation deepened Germany’s crisis",
  body: [
    "The Ruhr: French and Belgian troops occupied this industrial region in January 1923. Germany had fallen behind with reparations deliveries.",
    "Passive resistance: The government encouraged workers to refuse to work for the occupiers. It continued paying striking workers.",
    "The funding problem: Production fell and tax income declined. The government printed more money to meet its costs.",
  ],
  diagram: {
    kind: "timeline",
    alt: "A timeline links reparations imposed in 1919, the 1921 payment total and the occupation of the Ruhr in January 1923.",
    title: "Pressure on Germany",
    events: [
      { date: "1919", text: "Reparations imposed" },
      { date: "1921", text: "£6.6 billion total" },
      { date: "January 1923", text: "Ruhr occupation" },
    ],
  },
};
const shorter = [
  "The Ruhr: French and Belgian troops occupied this industrial region in January 1923.",
  "Passive resistance: Workers refused to work for the occupiers, and the government paid them.",
  "The funding problem: Tax income fell, so the government printed more money.",
];

describe("J1 fit: the heading at its actual wrapped height (I1a y9 s4)", () => {
  test("measured under its two-line heading, the body runs past the safe area on chalk", () => {
    const fit = fitWritten("diagram-slot", "default", y9s4, { headingAsIs: true });
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.field).toBe("body");
    expect(fit.themes).toContain("chalk");
    expect(fit.failure).toContain("heading above it stays on two lines");
  });

  test("a heading still wrapping after its re-writes: the body is written again for the room left", async () => {
    const asked: string[] = [];
    const fitted = await fitWithRewrite("diagram-slot", "default", y9s4, async (field) => {
      asked.push(field);
      return field === "heading" ? { heading: y9s4.heading } : { body: shorter };
    });
    expect(asked).toEqual(["heading", "heading", "body"]);
    expect(fitted.fit.ok).toBe(true);
    expect(fitted.out.heading).toBe(y9s4.heading);
    expect(fitted.out.body).toEqual(shorter);
    expect(fitWritten("diagram-slot", "default", fitted.out, { headingAsIs: true }).ok).toBe(true);
  });

  test("a body that still does not fit under the wrapped heading stays flagged, never saved as fitting", async () => {
    const fitted = await fitWithRewrite("diagram-slot", "default", y9s4, async (field) =>
      field === "heading" ? { heading: y9s4.heading } : { body: y9s4.body },
    );
    expect(fitted.fit.ok).toBe(false);
    expect(fitted.out.body).toEqual(y9s4.body);
  });
});

/** I1a y5 s8: the Severn floodplain at Caersws (upper course) captioned as the lower course. */
describe("J1 caption claims (I1a y5 s8, Caersws)", () => {
  const caersws = {
    heading: "The lower course crosses a broad valley",
    body: [
      "In the photograph: The Severn flows across a broad, flat floodplain. This shows the wide valley of its lower course.",
      "The lower course: The channel is usually wide and deep. The valley is broad and flat.",
    ],
    notes: "Sediment means small pieces of rock or soil carried by water.",
  };
  const source = `Part of the River Severn floodplain at Caersws - geograph.org.uk - 2032343 · ${coordinatesOf(
    { GPSLatitude: { value: "52.521170" }, GPSLongitude: { value: "-3.416597" } },
  )}`;

  test("the check is given the caption and the photo's source record with where it was taken", () => {
    const { system, user } = captionClaimsPrompt({
      topic: "Rivers",
      slides: [{ number: 8, text: [caersws.heading, ...caersws.body].join(" "), source }],
    });
    expect(CAPTION_CLAIMS_VERSION).toBe("caption-claims.v1");
    expect(system).toContain("upper, middle or lower course");
    expect(system).toContain("when you are unsure");
    expect(user).toContain("Slide 8");
    expect(user).toContain("This shows the wide valley of its lower course.");
    expect(user).toContain("Source record: Part of the River Severn floodplain at Caersws");
    expect(user).toContain("taken at 52.5212, -3.4166");
  });

  const claims: CaptionClaim[] = [
    {
      slide: 8,
      quote: "The Severn flows across a broad, flat floodplain",
      supported: true,
      why: "",
    },
    {
      slide: 8,
      quote: "This shows the wide valley of its lower course",
      supported: false,
      why: "Caersws is on the Severn's upper course, about 30 km from its source.",
    },
    { slide: 8, quote: "a claim the slide never makes at all", supported: false, why: "x" },
  ];

  test("an unsupported claim is placed on the field that carries it; supported and absent ones are not", () => {
    const faults = unsupportedClaims(claims, (n) => (n === 8 ? caersws : undefined));
    expect(faults).toEqual([
      {
        slide: 8,
        field: "body",
        quote: "This shows the wide valley of its lower course",
        why: "Caersws is on the Severn's upper course, about 30 km from its source.",
      },
    ]);
    expect(carriesClaim(caersws, "body", faults[0]?.quote ?? "")).toBe(true);
  });

  test("the fallback takes the claim's sentence out, so the caption names only what the photo shows", () => {
    const fixed = withoutClaim(caersws, "body", "This shows the wide valley of its lower course");
    expect(fixed?.body).toEqual([
      "In the photograph: The Severn flows across a broad, flat floodplain.",
      caersws.body[1],
    ]);
    expect(fixed?.heading).toBe(caersws.heading);
    expect(
      fixed && carriesClaim(fixed, "body", "This shows the wide valley of its lower course"),
    ).toBe(false);
    // A chunk left with no words, or a claim in the heading: no code fallback (the photo goes).
    expect(
      withoutClaim(
        { body: ["In the photograph: This is the lower course."] },
        "body",
        "This is the lower course",
      ),
    ).toBeUndefined();
    expect(
      withoutClaim(caersws, "heading", "The lower course crosses a broad valley"),
    ).toBeUndefined();
  });
});
