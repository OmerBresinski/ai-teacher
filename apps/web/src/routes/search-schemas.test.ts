import { describe, expect, it } from "bun:test";
import { defaultParseSearch } from "@tanstack/react-router";
import { devJobsSearchSchema } from "./dev-jobs.route";
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

  it("devJobsSearchSchema.jobId", () => {
    const parse = (qs: string) => devJobsSearchSchema.parse(defaultParseSearch(qs));
    expect(parse("?jobId=abc")).toEqual({ jobId: "abc" });
    // A purely numeric id decodes to a number and is dropped: ids must not be bare digits.
    expect(parse("?jobId=123")).toEqual({ jobId: undefined });
    expect(parse("?jobId=%5B%22a%22%5D")).toEqual({ jobId: undefined });
    expect(parse("")).toEqual({ jobId: undefined });
  });
});
