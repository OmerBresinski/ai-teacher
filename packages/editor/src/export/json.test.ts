import { describe, expect, it } from "bun:test";
import { parseLesson, parseWorksheet } from "@tj/domain/documents";
import { demoWorksheet } from "../model/demo-worksheet";
import { demoLibrary } from "../model/starter";
import {
  documentJsonBlob,
  lessonFilename,
  readDocumentFile,
  slugify,
  worksheetFilename,
} from "./json";

const water = () => {
  const lesson = demoLibrary().find((l) => l.title === "The water cycle");
  if (!lesson) throw new Error("fixture missing");
  return lesson;
};
const fractions = () => demoWorksheet();

const file = (name: string, content: string) =>
  new File([content], name, { type: "application/json" });

describe("slugify", () => {
  it("lowercases, strips accents and punctuation, and never returns nothing", () => {
    expect(slugify("The water cycle")).toBe("the-water-cycle");
    expect(slugify("  Café — l'été! ")).toBe("cafe-l-ete");
    expect(slugify("???")).toBe("untitled");
    expect(slugify("x".repeat(80))).toHaveLength(60);
  });
});

describe("filenames", () => {
  it("keep TeachDeck's suffixes", () => {
    expect(lessonFilename(water())).toBe("the-water-cycle.teachdeck.json");
    expect(worksheetFilename(fractions())).toBe("fractions-practice.worksheet.json");
  });
});

describe("JSON export round-trips through the parsers (row 6)", () => {
  it("a lesson", async () => {
    const lesson = water();
    const text = await documentJsonBlob(lesson).text();
    expect(parseLesson(JSON.parse(text))).toEqual(lesson);
  });

  it("a worksheet", async () => {
    const sheet = fractions();
    const text = await documentJsonBlob(sheet).text();
    expect(parseWorksheet(JSON.parse(text))).toEqual(sheet);
  });
});

describe("readDocumentFile", () => {
  it("tells a worksheet from a lesson by `blocks`", async () => {
    const lesson = water();
    const sheet = fractions();
    expect(await readDocumentFile(file("a.teachdeck.json", JSON.stringify(lesson)))).toEqual(
      lesson,
    );
    expect(await readDocumentFile(file("b.worksheet.json", JSON.stringify(sheet)))).toEqual(sheet);
  });

  it("names the file when it is not JSON", async () => {
    await expect(readDocumentFile(file("not-json.txt", "hello"))).rejects.toThrow(
      '"not-json.txt" is not a JSON file.',
    );
  });

  it("refuses a newer document version with TeachDeck's copy (row 9)", async () => {
    const newer = { ...water(), version: 2 };
    await expect(
      readDocumentFile(file("new.teachdeck.json", JSON.stringify(newer))),
    ).rejects.toThrow("This file was made with a newer version of TeachDeck (document version 2).");
  });

  it("refuses a JSON file that is not a document", async () => {
    await expect(readDocumentFile(file("x.json", JSON.stringify({ hello: 1 })))).rejects.toThrow();
  });
});
