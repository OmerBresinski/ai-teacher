import { describe, expect, test } from "bun:test";
import { newId, parseStorageKey, type WorkspaceId } from "@tj/domain";
import { PhotoSourceSchema } from "@tj/domain/documents";
import type { PhotoResult } from "./pexels";
import { StorePhotoError, storePhoto } from "./store-photo";

const ws = newId<WorkspaceId>();

function photo(): PhotoResult {
  return {
    id: "12345",
    width: 6000,
    height: 4000,
    alt: "A river",
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada/",
    pageUrl: "https://www.pexels.com/photo/12345/",
    src: {
      large: "https://images.pexels.com/photos/12345/large.jpeg",
      medium: "https://images.pexels.com/photos/12345/medium.jpeg",
      tiny: "https://images.pexels.com/photos/12345/tiny.jpeg",
    },
  };
}

interface PutCall {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

function memoryStorage() {
  const puts: PutCall[] = [];
  return {
    puts,
    storage: {
      put: async (key: string, body: Uint8Array, opts: { contentType: string }) => {
        puts.push({ key, bytes: body, contentType: opts.contentType });
        return { key };
      },
    },
  };
}

function stubFetch(body: Uint8Array, contentType: string, contentLength?: number) {
  const seen: string[] = [];
  const headers: Record<string, string> = { "content-type": contentType };
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  const fetch = ((input: string | URL | Request) => {
    seen.push(String(input));
    return Promise.resolve(new Response(body, { status: 200, headers }));
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const threeHundredKb = new Uint8Array(300 * 1024);

describe("storePhoto", () => {
  test("a slide stores the large rendition under images/ with a source block", async () => {
    const { storage, puts } = memoryStorage();
    const { fetch, seen } = stubFetch(threeHundredKb, "image/jpeg", threeHundredKb.length);
    const stored = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
      ids: () => "fixed-id",
    });
    expect(seen).toEqual(["https://images.pexels.com/photos/12345/large.jpeg"]);
    expect(stored.key).toBe(`${ws}/images/fixed-id.jpg`);
    expect(stored.url).toBe(`/files/${ws}/images/fixed-id.jpg`);

    const absolute = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
      ids: () => "fixed-id",
      baseUrl: "https://api.example",
    });
    expect(absolute.key).toBe(`${ws}/images/fixed-id.jpg`);
    expect(absolute.url).toBe(`https://api.example/files/${ws}/images/fixed-id.jpg`);

    const slashed = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
      ids: () => "fixed-id",
      baseUrl: "https://api.example/",
    });
    expect(slashed.url).toBe(`https://api.example/files/${ws}/images/fixed-id.jpg`);
    expect(stored.contentType).toBe("image/jpeg");
    expect(stored.width).toBe(6000);
    expect(stored.height).toBe(4000);
    expect(puts).toHaveLength(3);
    expect(puts[0]?.bytes).toEqual(threeHundredKb);
    const parsed = parseStorageKey(stored.key);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.value.parts[0] : null).toBe("images");
    expect(PhotoSourceSchema.parse(stored.source)).toEqual({
      provider: "pexels",
      id: "12345",
      pageUrl: "https://www.pexels.com/photo/12345/",
      photographer: "Ada",
      photographerUrl: "https://www.pexels.com/@ada/",
    });
  });

  test("a worksheet stores the medium rendition, never original", async () => {
    const { storage } = memoryStorage();
    const { fetch, seen } = stubFetch(threeHundredKb, "image/jpeg");
    await storePhoto({ photo: photo(), target: "worksheet", storage, workspaceId: ws, fetch });
    expect(seen).toEqual(["https://images.pexels.com/photos/12345/medium.jpeg"]);
    expect(seen[0]).not.toContain("original");
  });

  test("maps jpeg content types to jpg and keeps png", async () => {
    const { storage, puts } = memoryStorage();
    const png = new Uint8Array([1, 2, 3]);
    const { fetch } = stubFetch(png, "image/png; charset=binary");
    const stored = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
      ids: () => "pic",
    });
    expect(stored.key.endsWith(".png")).toBe(true);
    expect(puts[0]?.contentType).toBe("image/png");
  });

  test("a declared body over the cap is refused before anything is stored", async () => {
    const { storage, puts } = memoryStorage();
    const { fetch } = stubFetch(new Uint8Array([1]), "image/jpeg", 9_000_000);
    const error = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorePhotoError);
    expect((error as StorePhotoError).reason).toBe("too_large");
    expect(puts).toHaveLength(0);
  });

  test("a body over the cap with no content-length is refused after the read", async () => {
    const { storage, puts } = memoryStorage();
    const { fetch } = stubFetch(new Uint8Array(9 * 1024 * 1024), "image/jpeg");
    const error = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorePhotoError);
    expect((error as StorePhotoError).reason).toBe("too_large");
    expect(puts).toHaveLength(0);
  });

  test("a 2 MB body with no content-length is stored", async () => {
    const { storage, puts } = memoryStorage();
    const body = new Uint8Array(2 * 1024 * 1024).fill(7);
    const { fetch } = stubFetch(body, "image/jpeg");
    const stored = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
      ids: () => "big",
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.bytes).toEqual(body);
    expect(stored.key).toBe(`${ws}/images/big.jpg`);
  });

  test("a non-image content type is refused", async () => {
    const { storage, puts } = memoryStorage();
    const { fetch } = stubFetch(new Uint8Array([1, 2, 3]), "text/html");
    const error = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorePhotoError);
    expect((error as StorePhotoError).reason).toBe("not_an_image");
    expect(puts).toHaveLength(0);
  });

  test("a failed download is a fetch failure and stores nothing", async () => {
    const { storage, puts } = memoryStorage();
    const fetch = (() =>
      Promise.reject(new TypeError("down"))) as unknown as typeof globalThis.fetch;
    const error = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorePhotoError);
    expect((error as StorePhotoError).reason).toBe("fetch_failed");
    expect(puts).toHaveLength(0);
  });

  test("a body that fails mid-read is a fetch failure", async () => {
    const { storage, puts } = memoryStorage();
    const fetch = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("truncated"));
            },
          }),
          { status: 200, headers: { "content-type": "image/jpeg" } },
        ),
      )) as unknown as typeof globalThis.fetch;
    const error = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorePhotoError);
    expect((error as StorePhotoError).reason).toBe("fetch_failed");
    expect(puts).toHaveLength(0);
  });

  test("storage errors propagate", async () => {
    const { fetch } = stubFetch(threeHundredKb, "image/jpeg");
    const storage = {
      put: () => Promise.reject(new Error("disk full")),
    };
    const error = await storePhoto({
      photo: photo(),
      target: "slide",
      storage,
      workspaceId: ws,
      fetch,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("disk full");
  });
});
