import { describe, expect, test } from "bun:test";
import { createPexelsClient, PexelsError } from "./pexels";

const PHOTO = {
  id: 12345,
  width: 6000,
  height: 4000,
  url: "https://www.pexels.com/photo/12345/",
  photographer: "Ada",
  photographer_url: "https://www.pexels.com/@ada/",
  alt: "A river",
  src: {
    original: "https://images.pexels.com/photos/12345/original.jpeg",
    large2x: "https://images.pexels.com/photos/12345/large2x.jpeg",
    large: "https://images.pexels.com/photos/12345/large.jpeg",
    medium: "https://images.pexels.com/photos/12345/medium.jpeg",
    small: "https://images.pexels.com/photos/12345/small.jpeg",
    portrait: "https://images.pexels.com/photos/12345/portrait.jpeg",
    landscape: "https://images.pexels.com/photos/12345/landscape.jpeg",
    tiny: "https://images.pexels.com/photos/12345/tiny.jpeg",
  },
};

function stubFetch(
  respond: (url: string, init: RequestInit | undefined) => Response,
): typeof globalThis.fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(respond(String(input), init))) as typeof globalThis.fetch;
}

function okBody(photos: unknown[], nextPage?: string) {
  return {
    page: 1,
    per_page: 24,
    total_results: photos.length,
    ...(nextPage === undefined ? {} : { next_page: nextPage }),
    photos,
  };
}

describe("createPexelsClient search", () => {
  test("sends the documented URL and maps the body", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch((url, init) => {
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        return new Response(
          JSON.stringify(okBody([PHOTO], "https://api.pexels.com/v1/search?page=2")),
          { status: 200 },
        );
      }),
    });
    const page = await client.search({ query: "river", orientation: "landscape", page: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(
      "https://api.pexels.com/v1/search?query=river&orientation=landscape&page=1&per_page=24&locale=en-GB",
    );
    expect(seen[0]?.auth).toBe("k");
    expect(page.nextPage).toBe(2);
    expect(page.photos).toHaveLength(1);
    const photo = page.photos[0];
    expect(photo?.id).toBe("12345");
    expect(typeof photo?.id).toBe("string");
    expect(photo?.src).toEqual({
      large: "https://images.pexels.com/photos/12345/large.jpeg",
      medium: "https://images.pexels.com/photos/12345/medium.jpeg",
      tiny: "https://images.pexels.com/photos/12345/tiny.jpeg",
    });
    expect(photo?.pageUrl).toBe("https://www.pexels.com/photo/12345/");
    expect(photo?.photographerUrl).toBe("https://www.pexels.com/@ada/");
  });

  test("a missing next_page maps to nextPage null", async () => {
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(() => new Response(JSON.stringify(okBody([PHOTO])), { status: 200 })),
    });
    const page = await client.search({ query: "river" });
    expect(page.nextPage).toBeNull();
  });

  test("drops photos whose page or rendition URLs are not https", async () => {
    const httpLarge = {
      ...PHOTO,
      id: 1,
      src: { ...PHOTO.src, large: "http://cdn.example/large.jpeg" },
    };
    const httpPage = { ...PHOTO, id: 2, url: "http://www.pexels.com/photo/2/" };
    const httpTiny = {
      ...PHOTO,
      id: 3,
      src: { ...PHOTO.src, tiny: "http://cdn.example/tiny.jpeg" },
    };
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(
        () =>
          new Response(JSON.stringify(okBody([httpLarge, httpPage, httpTiny, PHOTO])), {
            status: 200,
          }),
      ),
    });
    const page = await client.search({ query: "river" });
    expect(page.photos.map((p) => p.id)).toEqual(["12345"]);
  });

  test("a 400 with locale retries once without it", async () => {
    const urls: string[] = [];
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch((url) => {
        urls.push(url);
        if (urls.length === 1) return new Response("bad locale", { status: 400 });
        return new Response(JSON.stringify(okBody([PHOTO])), { status: 200 });
      }),
    });
    const page = await client.search({ query: "river" });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("locale=en-GB");
    expect(urls[1]).not.toContain("locale");
    expect(page.photos).toHaveLength(1);
  });

  test("a repeated 400 rejects with PexelsError", async () => {
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(() => new Response("bad", { status: 400 })),
    });
    const error = await client.search({ query: "river" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PexelsError);
    expect((error as PexelsError).status).toBe(400);
    expect((error as PexelsError).retryAfterS).toBeUndefined();
  });

  test("a 429 carries retryAfterS from X-Ratelimit-Reset when present", async () => {
    const withReset = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(
        () => new Response("slow", { status: 429, headers: { "X-Ratelimit-Reset": "42" } }),
      ),
    });
    const error = await withReset.search({ query: "river" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PexelsError);
    expect((error as PexelsError).status).toBe(429);
    expect((error as PexelsError).retryAfterS).toBe(42);

    const withoutReset = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(() => new Response("slow", { status: 429 })),
    });
    const bare = await withoutReset.search({ query: "river" }).catch((e: unknown) => e);
    expect((bare as PexelsError).retryAfterS).toBeUndefined();
  });

  test("photo(id) maps one photo", async () => {
    const seen: string[] = [];
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch((url) => {
        seen.push(url);
        return new Response(JSON.stringify(PHOTO), { status: 200 });
      }),
    });
    const photo = await client.photo("12345");
    expect(seen).toEqual(["https://api.pexels.com/v1/photos/12345"]);
    expect(photo?.id).toBe("12345");
    expect(photo?.photographer).toBe("Ada");
    expect(photo?.src.medium).toBe("https://images.pexels.com/photos/12345/medium.jpeg");
  });

  test("photo(id) answers null on 404", async () => {
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(() => new Response("gone", { status: 404 })),
    });
    await expect(client.photo("404")).resolves.toBeNull();
  });

  test("network failures propagate as the fetch error", async () => {
    const client = createPexelsClient({
      apiKey: "k",
      fetch: stubFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    const error = await client.search({ query: "river" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
  });
});
