import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  fetchRemoteImage,
  formatCredit,
  httpsUrl,
  licenceLabel,
  MAX_GIF_BYTES,
  MAX_IMAGE_BYTES,
  mapOpenverseResult,
  OPENVERSE_PAGE_SIZE,
  openverseUrl,
  parseOpenversePage,
  SearchError,
  safeLinkUrl,
  searchOpenverse,
  typeFromUrl,
} from "./image-search";

/* TEACH-107 row 10: the Openverse half of TeachDeck's `image-search.test.ts` catalogue. */

/** Trimmed from a real `api.openverse.org/v1/images/?q=water+cycle` answer. */
const openverseRow = {
  id: "94854ef3-f87f-4849-88f1-9820c49f6bf0",
  title: "Water Cycle",
  foreign_landing_url: "https://www.flickr.com/photos/90896682@N06/8265046380",
  url: "https://live.staticflickr.com/8083/8265046380_4bfb79a5c4_b.jpg",
  creator: "Atmospheric Infrared Sounder",
  license: "by",
  license_version: "2.0",
  license_url: "https://creativecommons.org/licenses/by/2.0/",
  provider: "flickr",
  height: 524,
  width: 1024,
  thumbnail: "https://api.openverse.org/v1/images/94854ef3-f87f-4849-88f1-9820c49f6bf0/thumb/",
};

const openverseBody = {
  result_count: 240,
  page_count: 120,
  page_size: 2,
  page: 1,
  results: [openverseRow],
};

const realFetch = globalThis.fetch;
const stubFetch = (impl: (input?: unknown) => Promise<unknown>) => {
  const fetcher = mock(impl);
  globalThis.fetch = fetcher as unknown as typeof fetch;
  return fetcher;
};
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("licenceLabel", () => {
  test("names a Creative Commons code and keeps its version", () => {
    expect(licenceLabel("by", "2.0")).toBe("CC BY 2.0");
    expect(licenceLabel("by-sa", "4.0")).toBe("CC BY-SA 4.0");
    expect(licenceLabel("cc0", "1.0")).toBe("CC0 1.0");
  });

  test("drops the version from the public domain mark, which has none to speak of", () => {
    expect(licenceLabel("pdm", "1.0")).toBe("Public domain");
  });

  test("upper-cases an unknown code rather than dropping it", () => {
    expect(licenceLabel("mystery")).toBe("MYSTERY");
  });

  test("is empty when there is no licence", () => {
    expect(licenceLabel(undefined)).toBe("");
    expect(licenceLabel("  ")).toBe("");
  });
});

describe("formatCredit", () => {
  test("reads title by creator, licence", () => {
    expect(
      formatCredit({ title: "Water Cycle", creator: "Ada Lovelace", license: "CC BY 2.0" }),
    ).toBe("Water Cycle by Ada Lovelace, CC BY 2.0");
  });

  test("leaves out the parts it does not have", () => {
    expect(formatCredit({ title: "Water Cycle", license: "CC0" })).toBe("Water Cycle, CC0");
    expect(formatCredit({ title: "Water Cycle", creator: "Ada Lovelace" })).toBe(
      "Water Cycle by Ada Lovelace",
    );
    expect(formatCredit({ creator: "Ada Lovelace" })).toBe("Untitled by Ada Lovelace");
  });

  test("trims the whitespace an API row can carry", () => {
    expect(formatCredit({ title: "  Water Cycle ", creator: " Ada ", license: " CC0 " })).toBe(
      "Water Cycle by Ada, CC0",
    );
  });
});

describe("openverseUrl", () => {
  test("asks only for images a teacher may reuse and change", () => {
    const url = new URL(openverseUrl("water cycle", 2));
    expect(url.origin + url.pathname).toBe("https://api.openverse.org/v1/images/");
    expect(url.searchParams.get("q")).toBe("water cycle");
    expect(url.searchParams.get("license_type")).toBe("commercial,modification");
    expect(url.searchParams.get("page_size")).toBe(String(OPENVERSE_PAGE_SIZE));
    // Anonymous requests are refused above 20.
    expect(OPENVERSE_PAGE_SIZE).toBeLessThanOrEqual(20);
    expect(url.searchParams.get("page")).toBe("2");
  });
});

describe("mapOpenverseResult", () => {
  test("maps a row to the fields the panel and the element need", () => {
    expect(mapOpenverseResult(openverseRow)).toEqual({
      id: "94854ef3-f87f-4849-88f1-9820c49f6bf0",
      title: "Water Cycle",
      creator: "Atmospheric Infrared Sounder",
      url: "https://live.staticflickr.com/8083/8265046380_4bfb79a5c4_b.jpg",
      thumbnail: "https://api.openverse.org/v1/images/94854ef3-f87f-4849-88f1-9820c49f6bf0/thumb/",
      width: 1024,
      height: 524,
      credit: "Water Cycle by Atmospheric Infrared Sounder, CC BY 2.0",
      landingUrl: "https://www.flickr.com/photos/90896682@N06/8265046380",
      licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    });
  });

  test("falls back to the full file when there is no thumbnail", () => {
    const row = { ...openverseRow, thumbnail: "" };
    expect(mapOpenverseResult(row)?.thumbnail).toBe(openverseRow.url);
  });

  test("titles an untitled row rather than showing an empty credit", () => {
    const row = { ...openverseRow, title: "   ", creator: undefined };
    expect(mapOpenverseResult(row)?.credit).toBe("Untitled, CC BY 2.0");
  });

  test("rejects a row with no id or no file", () => {
    expect(mapOpenverseResult({ ...openverseRow, url: undefined })).toBeNull();
    expect(mapOpenverseResult({ ...openverseRow, id: "" })).toBeNull();
    expect(mapOpenverseResult(null)).toBeNull();
    expect(mapOpenverseResult("nope")).toBeNull();
  });
});

describe("parseOpenversePage", () => {
  test("maps the rows and points at the next page", () => {
    const page = parseOpenversePage(openverseBody, 1);
    expect(page.results).toHaveLength(1);
    expect(page.results[0]?.title).toBe("Water Cycle");
    expect(page.next).toBe("2");
  });

  test("stops at the last page", () => {
    expect(parseOpenversePage({ ...openverseBody, page_count: 1 }, 1).next).toBeUndefined();
    expect(parseOpenversePage({ ...openverseBody, page_count: 5 }, 5).next).toBeUndefined();
  });

  test("drops unusable rows and survives a shape it does not know", () => {
    const page = parseOpenversePage(
      { ...openverseBody, results: [openverseRow, { id: "x" }, 7] },
      1,
    );
    expect(page.results).toHaveLength(1);
    expect(parseOpenversePage(undefined).results).toEqual([]);
    expect(parseOpenversePage({ results: "nope" }).results).toEqual([]);
  });

  test("keeps the page number when every row was dropped", () => {
    const page = parseOpenversePage({ ...openverseBody, results: [{ id: "x" }, 7] }, 1);
    expect(page.results).toEqual([]);
    expect(page.next).toBe("2");
  });
});

describe("httpsUrl", () => {
  test("keeps an https address exactly as the API wrote it", () => {
    const signed = "https://live.staticflickr.com/8083/a_b.jpg?sig=A%2Bb";
    expect(httpsUrl(signed)).toBe(signed);
  });

  test("upgrades http on a host we know answers on https", () => {
    expect(httpsUrl("http://live.staticflickr.com/8083/a.jpg")).toBe(
      "https://live.staticflickr.com/8083/a.jpg",
    );
    expect(httpsUrl("http://upload.wikimedia.org/a.png")).toBe(
      "https://upload.wikimedia.org/a.png",
    );
  });

  test("drops http on a host we do not know, and every other scheme", () => {
    expect(httpsUrl("http://images.example.com/a.jpg")).toBeUndefined();
    expect(httpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(httpsUrl("data:image/png;base64,AAA")).toBeUndefined();
    expect(httpsUrl("not a url")).toBeUndefined();
    expect(httpsUrl(undefined)).toBeUndefined();
  });

  test("does not take a look-alike host for a known one", () => {
    expect(httpsUrl("http://flickr.com.evil.test/a.jpg")).toBeUndefined();
  });
});

describe("safeLinkUrl", () => {
  test("allows a page link on either scheme and refuses a script one", () => {
    expect(safeLinkUrl("https://www.flickr.com/photos/1")).toBe("https://www.flickr.com/photos/1");
    expect(safeLinkUrl("http://museum.example.org/item/1")).toBe(
      "http://museum.example.org/item/1",
    );
    expect(safeLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkUrl(undefined)).toBeUndefined();
  });
});

describe("https on the mapped rows", () => {
  test("drops a row whose file is http on an unknown host", () => {
    expect(
      mapOpenverseResult({ ...openverseRow, url: "http://images.example.com/a.jpg" }),
    ).toBeNull();
  });

  test("upgrades a file and thumbnail that came back as http", () => {
    const mapped = mapOpenverseResult({
      ...openverseRow,
      url: "http://live.staticflickr.com/8083/a.jpg",
      thumbnail: "http://api.openverse.org/v1/images/1/thumb/",
    });
    expect(mapped?.url).toBe("https://live.staticflickr.com/8083/a.jpg");
    expect(mapped?.thumbnail).toBe("https://api.openverse.org/v1/images/1/thumb/");
  });

  test("refuses a script address in a landing or licence link", () => {
    const mapped = mapOpenverseResult({
      ...openverseRow,
      foreign_landing_url: "javascript:alert(1)",
      license_url: "javascript:alert(2)",
    });
    expect(mapped?.landingUrl).toBeUndefined();
    expect(mapped?.licenseUrl).toBeUndefined();
  });
});

describe("typeFromUrl", () => {
  test("reads the type off the extension and ignores the query string", () => {
    expect(typeFromUrl("https://example.test/abc/rain.gif?x=1")).toBe("image/gif");
    expect(typeFromUrl("https://example.test/a/b.PNG")).toBe("image/png");
    expect(typeFromUrl("https://example.test/a/b.jpeg")).toBe("image/jpeg");
  });

  test("is undefined when the path says nothing", () => {
    expect(typeFromUrl("https://example.test/download")).toBeUndefined();
  });
});

describe("searchOpenverse", () => {
  test("carries the status a rate limit answered with", async () => {
    stubFetch(async () => ({ ok: false, status: 429 }));
    await expect(searchOpenverse("rain")).rejects.toMatchObject({ status: 429 });
    await expect(searchOpenverse("rain")).rejects.toBeInstanceOf(SearchError);
  });

  test("asks for the page the cursor names and parses the body", async () => {
    let asked = "";
    stubFetch(async (input) => {
      asked = String(input);
      return { ok: true, status: 200, json: async () => openverseBody };
    });
    const page = await searchOpenverse("rain", { cursor: "3" });
    expect(asked).toContain("page=3");
    expect(page.results).toHaveLength(1);
    expect(page.next).toBe("4");
  });
});

describe("fetchRemoteImage", () => {
  const answer = (blob: Blob, headers: Record<string, string> = {}) => ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    blob: async () => blob,
  });

  const stub = (response: object | Error) =>
    stubFetch(async () => {
      if (response instanceof Error) throw response;
      return response;
    });

  test("refuses a URL that is not https without going near the network", async () => {
    const fetcher = stub(answer(new Blob(["x"])));
    expect(await fetchRemoteImage("http://images.example.com/a.jpg")).toBeNull();
    expect(await fetchRemoteImage("javascript:alert(1)")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("types the File from the URL when the host omits Content-Type, so a GIF stays a GIF", async () => {
    stub(answer(new Blob(["gif-bytes"])));
    const file = await fetchRemoteImage("https://example.test/abc/rain.gif");
    expect(file?.type).toBe("image/gif");
  });

  test("takes the header type when there is one", async () => {
    stub(answer(new Blob(["png"]), { "content-type": "image/png; charset=binary" }));
    expect((await fetchRemoteImage("https://example.test/a"))?.type).toBe("image/png");
  });

  test("refuses a GIF over the 2MB cap on the declared length alone", async () => {
    const read = mock(async () => new Blob(["small"]));
    stubFetch(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(MAX_GIF_BYTES + 1) }),
      blob: read,
    }));
    expect(await fetchRemoteImage("https://example.test/abc/rain.gif")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  test("refuses a still over the 8MB cap when the header lied", async () => {
    stub(answer(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)]), { "content-type": "image/jpeg" }));
    expect(await fetchRemoteImage("https://example.test/big.jpg")).toBeNull();
  });

  test("allows a still that a GIF-sized cap would have refused", async () => {
    stub(answer(new Blob([new Uint8Array(MAX_GIF_BYTES + 1)]), { "content-type": "image/jpeg" }));
    expect(await fetchRemoteImage("https://example.test/photo.jpg")).not.toBeNull();
  });

  test("returns null when the host refuses CORS, which is the link fallback", async () => {
    stub(new TypeError("Failed to fetch"));
    expect(await fetchRemoteImage("https://example.test/a.jpg")).toBeNull();
  });

  test("rethrows when the caller aborted, so the panel does not insert a link", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("The operation was aborted.", "AbortError");
    stub(error);
    await expect(fetchRemoteImage("https://example.test/a.jpg", controller.signal)).rejects.toThrow(
      error,
    );
  });

  test("is empty, not an error, when the body has no bytes", async () => {
    stub(answer(new Blob([])));
    expect(await fetchRemoteImage("https://example.test/a.jpg")).toBeNull();
  });
});
