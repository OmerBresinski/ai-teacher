import { checkedCallout } from "../src/specs";

const cases = [
  [
    "Plants usually change extra glucose into starch before storing it.",
    "plants store the extra glucose they make as glucose",
    "Plants usually change extra glucose into starch before storing it.",
  ],
  [
    "Chlorophyll captures light energy; photosynthesis uses it with carbon dioxide and water to make glucose.",
    "chlorophyll is a food that plants make and eat",
    "Chlorophyll captures light energy; photosynthesis uses it with carbon dioxide and water to make glucose.",
  ],
  [
    "Particles stay the same size when heated; they spread further apart.",
    "particles expand when a substance is heated",
    "Particles stay the same size; they move faster and spread further apart.",
  ],
  [
    "Particles do not get bigger when heated.",
    "particles expand when a substance is heated",
    "Particles stay the same size; they move faster and spread further apart.",
  ],
  [
    "Printing money made each mark worth less, so prices soared.",
    "printing more money made Germany richer",
    "Printing more money made each mark worth less, so prices rose and savings became worthless.",
  ],
  [
    "Printing more money did not make Germany richer.",
    "printing more money made Germany richer",
    "Printing more money made each mark worth less, so prices rose and savings became worthless.",
  ],
];
for (const [text, belief, correction] of cases) {
  const r = checkedCallout(
    {
      kind: "content",
      heading: "H",
      body: "B",
      factRefs: ["k1"],
      callout: { kind: "watch-out", text },
    } as never,
    { kind: "watch-out", factRefs: ["m1"] },
    [{ id: "m1", belief, correction }],
  );
  console.log(
    `${r.fellBack ? "FALLBACK" : "kept    "} | ${text} => ${(r.spec as { callout: { text: string } }).callout.text}`,
  );
}
