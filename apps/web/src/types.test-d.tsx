/**
 * Compile-time contract checks, run by `tsc --noEmit` (never executed). If an `@ts-expect-error`
 * below stops erroring, either the route tree or the RPC types have regressed.
 */
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api";
// Pulls in the `Register` augmentation so `<Link to>` is checked against our route tree.
import type { router } from "@/router";

export type RegisteredRouter = typeof router;

// Known routes type-check.
export const links = [
  <Link key="home" to="/" />,
  <Link key="sign-in" to="/sign-in" search={{ redirect: "/" }} />,
  <Link key="jobs" to="/dev/jobs" search={{ jobId: "x" }} />,
];

// @ts-expect-error `/nope` is not a route
export const bad = <Link to="/nope" />;

// @ts-expect-error `name` must be a string
void api.hello.$get({ query: { name: 1 } });

// @ts-expect-error `nope` is not an API route
void api.nope;
