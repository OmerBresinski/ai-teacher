import { describe, expect, it } from "bun:test";
import { defaultParseSearch } from "@tanstack/react-router";
import { devJobsSearchSchema } from "./dev-jobs.route";
import { presentSearchSchema, worksheetPrintSearchSchema } from "./documents.route";
import { librarySearchSchema } from "./library.route";
import { signInSearchSchema } from "./sign-in.route";

/**
 * The router's default search parser JSON-decodes values: `?redirect=1` arrives as the number 1
 * and `?redirect=%5B%22a%22%5D` as `["a"]`. Malformed params must be dropped (`.catch(undefined)`),
 * not thrown to the root error page. Driven through the real parser so the cases stay honest.
 */
describe("search schemas drop malformed params", () => {
  it("signInSearchSchema.redirect", () => {
    const parse = (qs: string) => signInSearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?redirect=%2Fx")).toEqual({ redirect: "/x" });
    expect(parse("?redirect=1")).toEqual({ redirect: undefined });
    expect(parse("?redirect=%5B%22a%22%5D")).toEqual({ redirect: undefined });
    expect(parse("")).toEqual({ redirect: undefined });
  });

  it("signInSearchSchema.error", () => {
    const parse = (qs: string) => signInSearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?error=INVALID_TOKEN")).toEqual({ redirect: undefined, error: "INVALID_TOKEN" });
    expect(parse("?error=INVALID_TOKEN&redirect=%2Fx")).toEqual({
      redirect: "/x",
      error: "INVALID_TOKEN",
    });
    expect(parse("?error=1")).toEqual({ redirect: undefined, error: undefined });
    expect(parse("?error=%5B%22a%22%5D")).toEqual({ redirect: undefined, error: undefined });
  });

  it("devJobsSearchSchema.jobId", () => {
    const parse = (qs: string) => devJobsSearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?jobId=abc")).toEqual({ jobId: "abc" });
    // A purely numeric id decodes to a number and is dropped: ids must not be bare digits.
    expect(parse("?jobId=123")).toEqual({ jobId: undefined });
    expect(parse("?jobId=%5B%22a%22%5D")).toEqual({ jobId: undefined });
    expect(parse("")).toEqual({ jobId: undefined });
  });

  it("librarySearchSchema.q", () => {
    const parse = (qs: string) => librarySearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?q=water")).toEqual({ q: "water" });
    expect(parse("?q=123")).toEqual({ q: "" });
    expect(parse("?q=%5B%22water%22%5D")).toEqual({ q: "" });
    expect(parse("")).toEqual({ q: undefined });
  });

  it("presentSearchSchema: series, from and a 1-based slide", () => {
    const parse = (qs: string) => presentSearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?series=series-romans&from=view&slide=4")).toEqual({
      series: "series-romans",
      from: "view",
      slide: 4,
    });
    // `?slide=abc` and `?slide=0` are dropped, so the deck opens on slide 1.
    expect(parse("?slide=abc")).toEqual({ series: undefined, from: undefined, slide: undefined });
    expect(parse("?slide=0")).toEqual({ series: undefined, from: undefined, slide: undefined });
    expect(parse("?slide=2.5")).toEqual({ series: undefined, from: undefined, slide: undefined });
    expect(parse("?from=elsewhere")).toEqual({
      series: undefined,
      from: undefined,
      slide: undefined,
    });
    expect(parse("")).toEqual({ series: undefined, from: undefined, slide: undefined });
  });

  it('worksheetPrintSearchSchema.auto: `?auto=1` (a number to the parser) and a quoted "1" both mean print', () => {
    const parse = (qs: string) => worksheetPrintSearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?auto=1")).toEqual({ auto: "1" });
    expect(parse("?auto=%221%22")).toEqual({ auto: "1" });
    expect(parse("?auto=0")).toEqual({ auto: undefined });
    expect(parse("?auto=true")).toEqual({ auto: undefined });
    expect(parse("?auto=%5B%221%22%5D")).toEqual({ auto: undefined });
    expect(parse("")).toEqual({ auto: undefined });
  });
});
