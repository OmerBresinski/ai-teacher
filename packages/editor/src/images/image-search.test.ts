import { describe, expect, test } from "bun:test";
import { SearchError } from "./image-search";

describe("SearchError", () => {
  test("carries the status so the panel can say why", () => {
    const error = new SearchError("Too many", 429);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SearchError");
    expect(error.message).toBe("Too many");
    expect(error.status).toBe(429);
  });

  test("status is optional", () => {
    expect(new SearchError("Failed").status).toBeUndefined();
  });
});
