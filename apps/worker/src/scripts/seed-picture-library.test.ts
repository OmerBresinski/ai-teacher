/** Which lab rows may seed the production picture library (TEACH-84 part b, SEED.md). */
import { describe, expect, test } from "bun:test";
import type { BankImageRow } from "@tj/db";
import { LIBRARY_WORKSPACE_ID } from "@tj/domain";
import { qualifies } from "./seed-picture-library";

const commons = {
  provider: "commons",
  id: "File:Hen.jpg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Hen.jpg",
  photographer: "Jane Smith",
  photographerUrl: "https://commons.wikimedia.org/wiki/User:Jane",
  author: "Jane Smith",
  licence: "CC BY-SA 4.0",
};

function row(over: Partial<BankImageRow> = {}): BankImageRow {
  return {
    id: "r1",
    storageKey: `${LIBRARY_WORKSPACE_ID}/bank/r1.jpg`,
    mime: "image/jpeg",
    byteSize: 1,
    width: 3,
    height: 2,
    family: "landscape",
    provider: "commons",
    source: commons,
    licence: "CC BY-SA 4.0",
    credit: "Jane Smith",
    alt: "a hen",
    tags: [],
    request: "a hen",
    route: "real",
    generator: null,
    generatorTerms: null,
    prompt: null,
    costUsd: null,
    embedModel: "text-embedding-3-small",
    embedDims: 1536,
    embedding: [],
    flags: {},
    status: "ready",
    useCount: 0,
    lastUsedAt: null,
    createdAt: new Date(0),
    ...over,
  };
}

const generated = {
  provider: "generated" as const,
  source: { ...commons, provider: "generated", licence: "generated (openai-2026-10)" },
  generator: "gpt-image-2.5-sunburst",
  generatorTerms: "openai-2026-10",
  route: "generic",
  licence: "generated (openai-2026-10)",
  credit: "AI-generated",
};

describe("qualifies", () => {
  test("credited Commons and Pexels stock qualifies", () => {
    expect(qualifies(row())).toBe("ok");
    const pexels = { ...commons, provider: "pexels", licence: undefined };
    expect(qualifies(row({ provider: "pexels", source: pexels, licence: "Pexels licence" }))).toBe(
      "ok",
    );
  });
  test("stock without credit or licence, or with a licence the library refuses, does not", () => {
    expect(qualifies(row({ credit: " " }))).toBe("credit");
    expect(qualifies(row({ licence: null }))).toBe("credit");
    expect(qualifies(row({ source: { ...commons, licence: "CC BY-NC 4.0" } }))).toBe("licence");
  });
  test("ruling 163: a generated stand-in for a real or historical thing never seeds", () => {
    expect(qualifies(row(generated))).toBe("ok");
    expect(qualifies(row({ ...generated, route: "real" }))).toBe("ruling-163");
    expect(qualifies(row({ ...generated, flags: { faithful: true } }))).toBe("ruling-163");
    expect(qualifies(row({ ...generated, flags: { depicts: true } }))).toBe("ruling-163");
    expect(qualifies(row({ ...generated, route: "real", flags: { drawn: true } }))).toBe("ok");
    expect(qualifies(row({ ...generated, generatorTerms: null }))).toBe("provenance");
  });
  test("rejected rows, another embedding model or a foreign key never seed", () => {
    expect(qualifies(row({ status: "rejected" }))).toBe("not-ready");
    expect(qualifies(row({ embedModel: "other" }))).toBe("embedding");
    expect(qualifies(row({ storageKey: "ws/images/x.jpg" }))).toBe("key");
  });
});
