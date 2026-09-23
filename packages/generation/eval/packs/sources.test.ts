import { describe, expect, test } from "bun:test";
import {
  disallowedPrefixes,
  isAllowed,
  numberSentences,
  paragraphsOf,
  revisionOf,
  splitSentences,
  stripHtml,
  wikipediaUrls,
} from "./sources";

describe("sources", () => {
  test("robots: only the * group's Disallow prefixes apply, and the article path is governed", () => {
    const robots =
      "User-agent: Googlebot\nDisallow: /secret\n\nUser-agent: *\nDisallow: /api/\nDisallow: /wiki/Special:\n";
    const prefixes = disallowedPrefixes(robots);
    expect(prefixes).toEqual(["/api/", "/wiki/Special:"]);
    expect(isAllowed("/wiki/Photosynthesis", prefixes)).toBe(true);
    expect(isAllowed("/wiki/Special:Search", prefixes)).toBe(false);
    expect(wikipediaUrls("Id, ego and superego").page).toBe(
      "https://en.wikipedia.org/wiki/Id%2C_ego_and_superego",
    );
  });

  test("stripHtml drops reference markers and inline tags without breaking words", () => {
    const html =
      'photo<a href="#">pigment</a>-bearing organisms<sup class="mw-ref reference">[1]</sup>, such as <b>plants</b>.';
    expect(stripHtml(html)).toBe("photopigment-bearing organisms, such as plants.");
  });

  test("paragraphsOf keeps heading paths and stops at References", () => {
    const html = `<h2>Overview</h2><p>${"Photosynthesis makes sugar from light. ".repeat(3)}</p><h3>Detail</h3><p>${"Chloroplasts hold chlorophyll in their membranes. ".repeat(2)}</p><h2>References</h2><p>${"Not this paragraph at all, ever. ".repeat(3)}</p>`;
    const paras = paragraphsOf(html, "Photosynthesis");
    expect(paras.map((p) => p.heading)).toEqual([
      "Photosynthesis > Overview",
      "Photosynthesis > Overview > Detail",
    ]);
  });

  test("splitSentences guards common abbreviations and numbers sentences in order", () => {
    const s = splitSentences(
      "Rome fell c. AD 476. Caesar came in 55 BC. It was, e.g. a raid. Then he left.",
    );
    expect(s).toEqual([
      "Rome fell c. AD 476.",
      "Caesar came in 55 BC. It was, e.g. a raid.",
      "Then he left.",
    ]);
    const numbered = numberSentences(
      [{ heading: "h", text: "One sentence here. Another sentence here." }],
      2,
    );
    expect(numbered.map((x) => x.id)).toEqual(["s2.1", "s2.2"]);
  });

  test("revisionOf reads the REST header, then the ETag, then hashes the body", () => {
    expect(revisionOf({ "content-revision-id": "123" }, "x")).toBe("123");
    expect(revisionOf({ etag: 'W/"456/abc/view/html"' }, "x")).toBe("456");
    expect(revisionOf({}, "x")).toMatch(/^sha256:[0-9a-f]{16}$/);
  });
});
