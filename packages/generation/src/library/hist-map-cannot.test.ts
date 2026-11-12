import { expect, test } from "bun:test";
import { capabilityRefusals } from "./fill";

/*
 * hist_map's smallest view is the whole UK (round 3, y2-greatfire s3: "Pudding Lane in London,
 * 1660–1670" drew a tiny British Isles outline). A town, city district or street is refused, so
 * the slide falls back to a picture (PICTURE_FALLBACK); a UK-scale ask still draws.
 */
const refused = (intent: string) =>
  capabilityRefusals("hist_map", intent).some((r) => r.reason.includes("a city district"));

test("hist_map refuses a street, lane, city district or town plan", () => {
  for (const intent of [
    "Pudding Lane in London, 1660–1670",
    "the streets where the fire spread",
    "the City of London in 1666",
    "a district of London after the fire",
    "the town walls of York",
    "how the fire moved through the city",
  ]) {
    expect(refused(intent)).toBe(true);
  }
});

test("hist_map still draws UK-scale asks, including a region called a district", () => {
  for (const intent of [
    "Where and when was Hadrian's Wall built?",
    "Roman roads across Britain",
    "the Viking invasions of England, 793–878",
    "the Lake District and the north of England",
    "London and the River Thames on a map of England",
  ]) {
    expect(refused(intent)).toBe(false);
  }
});
