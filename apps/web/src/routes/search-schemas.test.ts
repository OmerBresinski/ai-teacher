import { describe, expect, it } from "bun:test";
import { devJobsSearchSchema } from "./dev-jobs.route";
import { signInSearchSchema } from "./sign-in.route";

/**
 * The router's search parser JSON-decodes values, so `?redirect=1` arrives as a number and
 * `?redirect[]=x` as an array. Malformed params must be dropped, not thrown to the error page.
 */
describe("search schemas drop malformed params", () => {
  it("signInSearchSchema.redirect", () => {
    expect(signInSearchSchema.parse({ redirect: "/x" })).toEqual({ redirect: "/x" });
    expect(signInSearchSchema.parse({ redirect: 1 })).toEqual({ redirect: undefined });
    expect(signInSearchSchema.parse({ redirect: ["a"] })).toEqual({ redirect: undefined });
    expect(signInSearchSchema.parse({})).toEqual({ redirect: undefined });
  });

  it("devJobsSearchSchema.jobId", () => {
    expect(devJobsSearchSchema.parse({ jobId: "abc" })).toEqual({ jobId: "abc" });
    expect(devJobsSearchSchema.parse({ jobId: 1 })).toEqual({ jobId: undefined });
    expect(devJobsSearchSchema.parse({ jobId: ["a"] })).toEqual({ jobId: undefined });
    expect(devJobsSearchSchema.parse({})).toEqual({ jobId: undefined });
  });
});
