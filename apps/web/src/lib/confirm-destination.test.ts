import { afterEach, describe, expect, it } from "bun:test";
import { landingFor, rememberLanding } from "./confirm-destination";

describe("landingFor (TEACH-214)", () => {
  afterEach(() => sessionStorage.clear());

  it("hands the confirm page's preview to the page the teacher lands on, and only that page", () => {
    rememberLanding({ kind: "new-lesson", topic: "Volcanoes" }, "/lessons/new?topic=Volcanoes");
    expect(landingFor("/lessons/new")).toEqual({ kind: "new-lesson", topic: "Volcanoes" });
    expect(landingFor("/series")).toBeNull();
  });

  it("expires after twenty seconds and never stores a token or email", () => {
    rememberLanding({ kind: "dashboard" }, "/");
    const stored = sessionStorage.getItem("tj:confirm-landing") ?? "";
    expect(stored).not.toMatch(/token|@/);
    expect(landingFor("/", Date.now() + 21_000)).toBeNull();
    expect(sessionStorage.getItem("tj:confirm-landing")).toBeNull();
  });

  it("ignores anything it did not write", () => {
    sessionStorage.setItem("tj:confirm-landing", "{not json");
    expect(landingFor("/")).toBeNull();
  });
});
