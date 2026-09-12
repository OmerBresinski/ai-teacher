import { describe, expect, it } from "bun:test";
import { printViewHref, worksheetPrintHref } from "./pdf";

/* TEACH-110 row 2: the exact param set the print route's search schema reads. */
describe("printViewHref", () => {
  it("writes auto=1 alone by default", () => {
    expect(printViewHref("abc")).toBe("/l/abc/print?auto=1");
  });

  it("writes only the options that are on, with the range URL-encoded", () => {
    expect(printViewHref("abc", { answers: true, slides: "1-3, 5" })).toBe(
      "/l/abc/print?auto=1&answers=1&slides=1-3%2C+5",
    );
    expect(printViewHref("abc", { notes: true })).toBe("/l/abc/print?auto=1&notes=1");
    expect(printViewHref("abc", { layout: "handout3" })).toBe("/l/abc/print?auto=1&handout=3");
    expect(printViewHref("abc", { layout: "slides" })).toBe("/l/abc/print?auto=1");
  });

  it("drops 'All' from the range and auto when it is off", () => {
    expect(printViewHref("abc", { slides: "All", auto: false })).toBe("/l/abc/print");
    expect(printViewHref("abc", { slides: "  ", auto: false })).toBe("/l/abc/print");
  });

  it("encodes the id", () => {
    expect(printViewHref("a b", { auto: false })).toBe("/l/a%20b/print");
  });
});

describe("worksheetPrintHref", () => {
  it("prints automatically unless told not to", () => {
    expect(worksheetPrintHref("w1")).toBe("/w/w1/print?auto=1");
    expect(worksheetPrintHref("w1", { auto: false })).toBe("/w/w1/print");
  });
});
