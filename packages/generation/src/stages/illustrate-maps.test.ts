import { describe, expect, test } from "bun:test";
import { mapsSearch, wantsMap } from "./illustrate";

// TEACH-251 part aa (romans verify5 s4): the director asked for a map; its map searches went to
// the ordinary Commons search, which refuses maps, so no map could ever be found.
describe("a picture that is a map searches Commons map files", () => {
  const map = {
    request:
      "A map of Britain around AD 122 shows Hadrian’s Wall across northern Britain, from Wallsend to Bowness-on-Solway",
  };
  test("a map request's map searches use maps; its other searches do not", () => {
    expect(wantsMap(map)).toBe(true);
    expect(mapsSearch("Hadrian's Wall map", map)).toBe(true);
    expect(mapsSearch("Hadrian's Wall map north", map)).toBe(true);
    expect(mapsSearch("Roman Britain AD 122", map)).toBe(false);
  });
  test("a historical or simple map request counts; a scene that only mentions a map does not", () => {
    expect(wantsMap({ request: "A historical map of Roman Britain" })).toBe(true);
    expect(wantsMap({ request: "Maps of the Roman Empire at its height" })).toBe(true);
    expect(wantsMap({ request: "A Roman officer studying a map in his tent" })).toBe(false);
    expect(mapsSearch("officer map tent", { request: "A Roman officer studying a map" })).toBe(
      false,
    );
  });
  test("a locator-map query always uses maps (part v)", () => {
    expect(mapsSearch("Hadrian's Wall locator map", { request: "A stretch of the wall" })).toBe(
      true,
    );
  });
});
