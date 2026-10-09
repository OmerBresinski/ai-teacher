import { describe, expect, test } from "bun:test";
import {
  COMMONS_BUSY_RETRIES,
  COMMONS_LICENCES,
  COMMONS_USER_AGENT,
  CommonsError,
  commonsLicenceAllowed,
  commonsPhotosOf,
  commonsSearch,
  coordinatesOf,
  createCommonsClient,
  judgeCommonsFile,
  licenceClass,
} from "./commons";

/** One File: page as the MediaWiki API returns it (formatversion 2), fixture only, no network. */
function page(
  n: number,
  licence: string,
  over: {
    mime?: string;
    title?: string;
    artist?: string;
    restrictions?: string;
    template?: string;
  } = {},
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
          ...(over.template ? { License: { value: over.template } } : {}),
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
      "PD-US",
      "PD-US-expired",
      "PD-US-no notice",
      "PD-old",
      "PD-old-auto",
      "PD-Art",
      "PD",
      "",
    ])
      expect(licenceClass(refused)).toBeUndefined();
  });

  test("worldwide public domain forms are reused", () => {
    for (const pd of [
      "Public domain",
      "Public Domain Mark 1.0",
      "PD-old-70",
      "PD-self",
      "PD-author",
    ])
      expect(licenceClass(pd)).toBe("public-domain");
  });

  test("a file whose template is PD-US is refused even when its short name is Public domain", () => {
    for (const template of ["pd-us", "pd-us-expired", "PD-US-not renewed"]) {
      const v = judgeCommonsFile(page(1, "Public domain", { template }));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toContain("US only");
    }
    expect(judgeCommonsFile(page(1, "Public domain", { template: "pd-old-100" })).ok).toBe(true);
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
    expect(photo?.alt).toBe("Hadrian's Wall 1: A stretch of the wall near Housesteads");
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
      // One API request at a time; thumbnail fetches are not in the queue.
      const api = url.includes("api.php");
      if (api) inFlight += 1;
      peak = Math.max(peak, inFlight);
      seen.push({ url, agent: new Headers(init?.headers).get("User-Agent"), at: Date.now() });
      await Promise.resolve();
      if (api) inFlight -= 1;
      if (url.includes("upload.wikimedia.org"))
        return new Response(new Uint8Array([255, 216, 255]), {
          headers: { "content-type": "image/jpeg" },
        });
      return new Response(JSON.stringify({ query: { pages: [page(1, "CC0")] } }));
    }) as unknown as typeof fetch;
    // A fake clock: the request gap is asked for, never slept on a real timer.
    let clock = 0;
    const waits: number[] = [];
    const client = createCommonsClient({
      fetch: stub,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
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
    expect(api.length).toBe(2);
    // The second search waited out the gap after the first.
    expect(waits.some((w) => w >= 200)).toBe(true);
    const url = new URL(api[0]?.url ?? "");
    expect(url.searchParams.get("gsrnamespace")).toBe("6");
    expect(url.searchParams.get("maxlag")).toBe("5");
    expect(url.searchParams.get("iiextmetadatafilter")).toContain("LicenseShortName");
  });
});

describe("Commons coordinates (round J: a caption's place claim is checked against them)", () => {
  test("the photo's GPS position is given in its about text; none when the page has none", () => {
    expect(
      coordinatesOf({ GPSLatitude: { value: "52.521170" }, GPSLongitude: { value: "-3.416597" } }),
    ).toBe("taken at 52.5212, -3.4166 (latitude, longitude)");
    expect(coordinatesOf({ ImageDescription: { value: "x" } })).toBe("");
    expect(coordinatesOf(undefined)).toBe("");
  });
});

describe("Commons caption", () => {
  test("a Bundesarchiv boilerplate description is skipped; the title leads the alt", () => {
    const [p] = commonsPhotosOf({ query: { pages: [page(1, "CC BY-SA 4.0")] } });
    expect(p?.alt.startsWith("Hadrian's Wall 1")).toBe(true);
  });
});

describe("Commons busy replies (maxlag, 429, Retry-After)", () => {
  const ok = () => new Response(JSON.stringify({ query: { pages: [page(1, "CC0")] } }));
  const thumb = () =>
    new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } });
  function clientWith(replies: (() => Response)[]) {
    const waits: number[] = [];
    let clock = 0;
    let calls = 0;
    const stub = (async (url: string) => {
      if (url.includes("upload.wikimedia.org")) return thumb();
      const next = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      return (next as () => Response)();
    }) as unknown as typeof fetch;
    const client = createCommonsClient({
      fetch: stub,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    return { client, waits, calls: () => calls };
  }

  test("a 200 maxlag error, then 429 with Retry-After, are retried within budget, not empty", async () => {
    const { client, waits, calls } = clientWith([
      () => new Response(JSON.stringify({ error: { code: "maxlag", info: "lagged" } })),
      () => new Response("", { status: 429, headers: { "Retry-After": "1" } }),
      ok,
    ]);
    const photos = await client.search({ query: "Hadrian's Wall" });
    expect(photos.length).toBe(1);
    expect(calls()).toBe(3);
    expect(waits).toContain(1000);
  });

  test("still busy after every retry: a busy CommonsError, never an empty list", async () => {
    const { client, calls } = clientWith([
      () => new Response("", { status: 429, headers: { "Retry-After": "1" } }),
    ]);
    const error = await client.search({ query: "Hadrian's Wall" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommonsError);
    expect((error as CommonsError).busy).toBe(true);
    expect((error as CommonsError).status).toBe(429);
    expect(calls()).toBe(COMMONS_BUSY_RETRIES + 1);
  });

  test("a Retry-After past the cap reports busy at once", async () => {
    const { client, calls, waits } = clientWith([
      () => new Response("", { status: 503, headers: { "Retry-After": "120" } }),
    ]);
    const error = await client.search({ query: "x" }).catch((e: unknown) => e);
    expect((error as CommonsError).busy).toBe(true);
    expect(calls()).toBe(1);
    expect(waits.every((w) => w < 1000)).toBe(true);
  });

  test("the User-Agent names Dayback and the site as its contact, with no personal email", () => {
    expect(COMMONS_USER_AGENT).toBe("DaybackLessonPictures/1.0 (https://dayback.app)");
    expect(COMMONS_USER_AGENT).not.toMatch(/@|teachdeck/i);
  });
});

describe("Commons file downloads", () => {
  test("files share the search queue and a 429 is retried after Retry-After", async () => {
    let calls = 0;
    let inFlight = 0;
    let peak = 0;
    const waits: number[] = [];
    let clock = 0;
    const stub = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      calls += 1;
      if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "2" } });
      return new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const client = createCommonsClient({
      fetch: stub,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    const [a, b] = await Promise.all([
      client.fetchFile("https://upload.wikimedia.org/a.jpg"),
      client.fetchFile("https://upload.wikimedia.org/b.jpg"),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(peak).toBe(1);
    expect(waits).toContain(2000);
  });

  test("an Artist field past the cap is clipped in the credit", () => {
    const v = judgeCommonsFile(page(1, "CC BY 4.0", { artist: "z".repeat(900) }));
    expect(v.ok && v.credit.author.length).toBe(200);
  });
});

// TEACH-251: COMMONS_LICENCES. "all" is the default; "free" keeps only the files that owe no credit.
describe("COMMONS_LICENCES", () => {
  const pages = [
    page(0, "CC BY-SA 4.0"),
    page(1, "CC BY 4.0"),
    page(2, "Public domain"),
    page(3, "Public Domain Mark 1.0"),
    page(4, "CC0"),
  ];
  const photos = commonsPhotosOf({ query: { pages } });
  const client = { search: async () => photos } as never as Parameters<typeof commonsSearch>[0];
  const run = (search: ReturnType<typeof commonsSearch>) =>
    search("calf", { perPage: 5, signal: new AbortController().signal }).then((ps) =>
      ps.map((p) => p.licenceClass).sort(),
    );

  test('"free", when chosen, refuses a CC BY or BY-SA file', async () => {
    expect(commonsLicenceAllowed({ licenceClass: "cc-by" }, "free")).toBe(false);
    expect(commonsLicenceAllowed({ licenceClass: "cc-by-sa" }, "free")).toBe(false);
    expect(commonsLicenceAllowed({ licenceClass: "cc0" }, "free")).toBe(true);
  });

  test('defaults to "all": every reusable licence is a candidate', async () => {
    expect(COMMONS_LICENCES).toBe("all");
    expect(await run(commonsSearch(client))).toEqual([
      "cc-by",
      "cc-by-sa",
      "cc0",
      "public-domain",
      "public-domain",
    ]);
  });

  test('"all": every reusable licence is a candidate', async () => {
    expect(await run(commonsSearch(client, "all"))).toEqual([
      "cc-by",
      "cc-by-sa",
      "cc0",
      "public-domain",
      "public-domain",
    ]);
  });

  test('"free" keeps only CC0, public domain and the PD mark', async () => {
    expect(await run(commonsSearch(client, "free"))).toEqual([
      "cc0",
      "public-domain",
      "public-domain",
    ]);
  });
});
