import { describe, expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { isUniqueViolation, PG_UNIQUE_VIOLATION } from "./errors";

// Pure classification; no database needed.

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), {
    code,
    constraint_name: constraint,
  });

describe("isUniqueViolation", () => {
  test("recognises a bare postgres.js error with code 23505", () => {
    expect(isUniqueViolation(pgError(PG_UNIQUE_VIOLATION))).toBe(true);
  });

  test("walks Drizzle's `cause` chain to the driver error", () => {
    const wrapped = new DrizzleQueryError("insert …", [], pgError(PG_UNIQUE_VIOLATION, "x_uidx"));
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "x_uidx")).toBe(true);
  });

  test("a different constraint does not match when one is named", () => {
    expect(isUniqueViolation(pgError(PG_UNIQUE_VIOLATION, "other_uidx"), "x_uidx")).toBe(false);
  });

  test("other SQLSTATEs, plain errors and non-objects are not unique violations", () => {
    expect(isUniqueViolation(pgError("23503"))).toBe(false);
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  test("stops on a self-referencing cause chain", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });
});
