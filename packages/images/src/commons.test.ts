import { describe, expect, test } from "bun:test";
import {
  COMMONS_USER_AGENT,
  commonsPhotosOf,
  createCommonsClient,
  judgeCommonsFile,
  licenceClass,
} from "./commons";

/** One File: page as the MediaWiki API returns it (formatversion 2), fixture only, no network. */
function page(
  n: number,
  licence: string,
  over: { mime?: string; title?: string; artist?: string; restrictions?: string } = {},
) {
  const name = over.title ?? `Hadrian's Wall ${n}.jpg`;
  const file = name.replace(/ /g, "_");
  return {
    pageid: 1000 + n,
    index: n,
    title: `File:${name}`,
    imageinfo: [
      {
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/1280px-${file}`,
        thumbwidth: 1280,
        thumbheight: 960,
        width: 4000,
        height: 3000,
        mime: over.mime ?? "image/jpeg",
        extmetadata: {
          LicenseShortName: { value: licence },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
          Artist: {
            value: over.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Ada">Ada</a>',
          },
          ...(over.restrictions ? { Restrictions: { value: over.restrictions } } : {}),
          ImageDescription: { value: "<p>A stretch of the wall near Housesteads</p>" },
        },
      },
    ],
  };
}

describe("Commons licence filter", () => {
  test("public domain, CC0, CC BY and CC BY-SA only", () => {
    expect(licenceClass("Public domain")).toBe("public-domain");
    expect(licenceClass("PD-old-100")).toBe("public-domain");
    expect(licenceClass("CC0")).toBe("cc0");
    expect(licenceClass("CC BY 4.0")).toBe("cc-by");
    expect(licenceClass("CC BY-SA 3.0 de")).toBe("cc-by-sa");
    expect(licenceClass("CC BY-SA 2.5")).toBe("cc-by-sa");
    for (const refused of [
      "CC BY-NC 4.0",
      "CC BY-NC-SA 2.0",
      "CC BY-ND 4.0",
      "GFDL",
      "Fair use",
      "Copyrighted",
      "",
    ])
      expect(licenceClass(refused)).toBeUndefined();
  });

  test("restrictions, non-photographs, maps and logos are refused", () => {
    expect(judgeCommonsFile(page(1, "CC BY-SA 4.0", { restrictions: "trademarked" })).ok).toBe(
      false,
    );
    expect(judgeCommonsFile(page(2, "CC BY-SA 4.0", { restrictions: "personality" })).ok).toBe(
      false,
    );
    expect(judgeCommonsFile(page(3, "Public domain", { mime: "image/svg+xml" })).ok).toBe(false);
    expect(judgeCommonsFile(page(4, "Public domain", { mime: "image/png" })).ok).toBe(false);
    expect(judgeCommonsFile(page(5, "CC0", { title: "Map of Hadrian's Wall.jpg" })).ok).toBe(false);
    expect(judgeCommonsFile(page(6, "CC0", { title: "Roman army logo.jpg" })).ok).toBe(false);
    // Unless the brief asks for a drawing.
    expect(
      judgeCommonsFile(page(7, "CC0", { title: "Map of Hadrian's Wall.jpg" }), {
        allowDrawings: true,
      }).ok,
    ).toBe(true);
  });

  test("an attribution licence with no author is refused; public domain may be anonymous", () => {
    expect(judgeCommonsFile(page(1, "CC BY 4.0", { artist: "" })).ok).toBe(false);
    const pd = judgeCommonsFile(page(2, "Public domain", { artist: "" }));
    expect(pd.ok && pd.credit.author).toBe("Unknown author");
  });

  test("an accepted photo carries author, licence, licence URL and file page; HTML stripped", () => {
    const [photo] = commonsPhotosOf({ query: { pages: [page(1, "CC BY-SA 4.0")] } });
    expect(photo?.provider).toBe("commons");
    expect(photo?.credit).toEqual({
      author: "Ada",
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Hadrian's_Wall_1.jpg",
    });
    expect(photo?.alt).toBe("A stretch of the wall near Housesteads");
    // Only Wikimedia's standard thumbnail widths are served (200 and 640 answer 400).
    expect(photo?.src.tiny).toContain("/250px-Hadrian's_Wall_1.jpg");
    expect(photo?.src.medium).toContain("/500px-");
    expect(photo?.src.large).toContain("/1280px-");
  });

  test("public domain and CC0 are preferred when otherwise equal, never over a much better match", () => {
    const pages = [
      page(0, "CC BY-SA 4.0"),
      page(1, "CC BY 4.0"),
      page(2, "Public domain"),
      page(3, "CC BY-NC 4.0"),
      page(4, "CC BY-SA 4.0"),
      page(5, "CC0"),
    ];
    const ids = commonsPhotosOf({ query: { pages } }).map((p) => p.id);
    // Band 0-3: public domain first, then the BY / BY-SA in search order; the NC file is gone.
    // Band 4-7: CC0 ahead of BY-SA.
    expect(ids).toEqual([
      "commons-1002",
      "commons-1000",
      "commons-1001",
      "commons-1005",
      "commons-1004",
    ]);
  });

  test("a malformed body gives no photos", () => {
    expect(commonsPhotosOf({ error: "maxlag" })).toEqual([]);
    expect(commonsPhotosOf(null)).toEqual([]);
  });

  test("the client sends a descriptive User-Agent and one request at a time (stub fetch)", async () => {
    const seen: { url: string; agent: string | null; at: number }[] = [];
    let inFlight = 0;
    let peak = 0;
    const stub = (async (url: string, init?: RequestInit) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      seen.push({ url, agent: new Headers(init?.headers).get("User-Agent"), at: Date.now() });
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (url.includes("upload.wikimedia.org"))
        return new Response(new Uint8Array([255, 216, 255]), {
          headers: { "content-type": "image/jpeg" },
        });
      return new Response(JSON.stringify({ query: { pages: [page(1, "CC0")] } }));
    }) as unknown as typeof fetch;
    const client = createCommonsClient({ fetch: stub });
    const [a, b] = await Promise.all([
      client.search({ query: "Hadrian's Wall" }),
      client.search({ query: "Colosseum" }),
    ]);
    expect(a?.length).toBe(1);
    expect(b?.length).toBe(1);
    expect(peak).toBe(1);
    expect(seen.every((s) => s.agent === COMMONS_USER_AGENT)).toBe(true);
    // The judge is shown an inlined thumbnail, never a Wikimedia URL it cannot fetch.
    expect(a?.[0]?.src.tiny).toBe("data:image/jpeg;base64,/9j/");
    const api = seen.filter((s) => s.url.includes("api.php"));
    expect((api[1]?.at ?? 0) - (api[0]?.at ?? 0)).toBeGreaterThanOrEqual(200);
    const url = new URL(api[0]?.url ?? "");
    expect(url.searchParams.get("gsrnamespace")).toBe("6");
    expect(url.searchParams.get("maxlag")).toBe("5");
    expect(url.searchParams.get("iiextmetadatafilter")).toContain("LicenseShortName");
  });
});
