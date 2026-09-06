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
  <Link key="lessons" to="/lessons" search={{ q: "water" }} />,
  <Link key="worksheets" to="/worksheets" search={{ q: "water" }} />,
  <Link key="series" to="/series" search={{ q: "water" }} />,
  <Link key="series-detail" to="/series/$seriesId" params={{ seriesId: "series-romans" }} />,
  <Link key="lesson-editor" to="/l/$lessonId" params={{ lessonId: "demo-water-cycle" }} />,
  <Link key="lesson-present" to="/l/$lessonId/present" params={{ lessonId: "demo-water-cycle" }} />,
  <Link
    key="worksheet-editor"
    to="/w/$worksheetId"
    params={{ worksheetId: "fraction-practice" }}
  />,
  <Link
    key="worksheet-print"
    to="/w/$worksheetId/print"
    params={{ worksheetId: "fraction-practice" }}
  />,
];

// @ts-expect-error `/nope` is not a route
export const bad = <Link to="/nope" />;

// @ts-expect-error `name` must be a string
void api.hello.$get({ query: { name: 1 } });

// @ts-expect-error `nope` is not an API route
void api.nope;
