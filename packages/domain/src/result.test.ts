import { describe, expect, test } from "bun:test";
import { err, isErr, isOk, ok, type Result } from "./result";

describe("Result", () => {
  test("ok/err construct the discriminated union", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("bad")).toEqual({ ok: false, error: "bad" });
  });

  test("isOk/isErr narrow", () => {
    const results: Result<number, string>[] = [ok(1), err("bad")];
    const [a, b] = results;
    if (a && isOk(a)) expect(a.value).toBe(1);
    else throw new Error("expected ok");
    if (b && isErr(b)) expect(b.error).toBe("bad");
    else throw new Error("expected err");
    expect(a && isErr(a)).toBe(false);
    expect(b && isOk(b)).toBe(false);
  });
});
