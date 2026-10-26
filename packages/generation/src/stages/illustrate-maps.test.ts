import { describe, expect, test } from "bun:test";
import { drawnAsk, mapsSearch, wantsMap } from "./illustrate";
import { mapQueriesOf } from "./picture-director";

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

// TEACH-251 part ah (romans verify7 s4): the library map failed, and its fallback ask was the
// drawing intent itself. "Show a north-up map" was not read as a map, and the ask carried no map
// searches, so map-first searched "show north up" and "why romans built" among photographs.
describe("a library map's fallback ask searches map files by the places it names", () => {
  const intent =
    "Show a north-up map of Britain with north marked. Highlight Roman-controlled land south of Hadrian’s Wall in AD 122. Draw the wall between the River Tyne near modern Newcastle and the Solway Firth.";
  test("a drawing intent that opens with a verb is a map request", () => {
    expect(wantsMap({ request: intent })).toBe(true);
    expect(mapsSearch("Hadrian's Wall map", { request: intent })).toBe(true);
    expect(wantsMap({ request: "Show pupils studying a map in class" })).toBe(false);
  });
  test("its searches are '<place> map', longest names first, never its opening words", () => {
    const q = mapQueriesOf(intent, "Why the Romans built Hadrian’s Wall");
    expect(q[0]).toBe("Hadrian's Wall map");
    expect(q).toHaveLength(3);
    expect(q.every((x) => x.endsWith(" map"))).toBe(true);
    expect(q.some((x) => /^(show|highlight|draw|ad)\b/i.test(x))).toBe(false);
    // A map with no place in its words falls back to the lesson title's names.
    expect(mapQueriesOf("A simple map", "Why the Romans built Hadrian’s Wall")).toEqual([
      "Romans map",
      "Hadrian's Wall map",
    ]);
  });
});

// TEACH-251 part an (verify8 S2): a placed map or diagram is laid out whole, never cropped; a photo
// that only holds one (a map in someone's hands, a graph on a screen) keeps the photo's crop.
describe("a placed picture is shown whole when it is a drawn thing", () => {
  const photo = "Roman soldiers at a fort gate. soldiers";
  test("the ask is for a map (verify8 S2's ask), or the picker saw a drawn thing as the subject", () => {
    expect(drawnAsk("A map of Britain around AD 122 shows Hadrian’s Wall", [])).toBe(true);
    expect(drawnAsk(photo, ["a map of Roman Britain"])).toBe(true);
    expect(drawnAsk(photo, ["Roman Britain map"])).toBe(true);
    expect(drawnAsk(photo, ["bar chart of rainfall"])).toBe(true);
  });
  test("a photo that only shows a drawn thing in use is not one", () => {
    expect(drawnAsk(photo, ["people reading a map"])).toBe(false);
    expect(drawnAsk(photo, ["a graph on a screen"])).toBe(false);
    expect(drawnAsk(photo, ["a bar graph on a screen"])).toBe(false);
    expect(drawnAsk(photo, ["a plan of the day"])).toBe(false);
    expect(drawnAsk(photo, ["stone wall", "Hadrian's Wall marked on a map"])).toBe(false);
  });
});
