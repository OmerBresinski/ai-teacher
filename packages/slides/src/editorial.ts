/*
 * The editorial tag (ADR 0025 §7, TEACH-257; the two kinds of rule are described in `specs.ts`).
 * It lives in a module of its own, with no imports inside the package, because the Figure
 * templates tag their value rules with it and `specs.ts` embeds those rules in the diagram spec
 * (TEACH-89): were a template to import it from `specs.ts`, `specs.ts` → `figures` →
 * `right-triangle.ts` → `specs.ts` would be a cycle in which some load orders read the templates
 * before they exist. `specs.ts` re-exports everything here, so callers import it from there.
 */

/** The `params` key an editorial issue carries (Zod keeps `params` on custom issues). */
export const EDITORIAL_PARAM = "editorial";

/** The `params` key carrying the log-safe form of a message that quotes a model value. */
export const LOG_PARAM = "log";

/** What `editorialIssue` returns: the one object both `.refine(fn, …)` and `ctx.addIssue(…)` take. */
export type EditorialIssue = {
  code: "custom";
  message: string;
  path?: PropertyKey[] | undefined;
  params: { [EDITORIAL_PARAM]: true; [LOG_PARAM]?: string };
};

/**
 * The tag every editorial rule carries. Use it as the second argument of `.refine` or as the
 * argument of `ctx.addIssue` in a `superRefine`; a rule written any other way is a shape rule.
 * `log` is required whenever `message` interpolates a value the model wrote (ADR 0015): it is the
 * same sentence with that value left out, and it is what reaches the log; a message built only
 * from our own words and numbers needs none.
 */
export function editorialIssue(
  message: string,
  path?: PropertyKey[],
  log?: string,
): EditorialIssue {
  return {
    code: "custom",
    message,
    ...(path === undefined ? {} : { path }),
    params: { [EDITORIAL_PARAM]: true, ...(log === undefined ? {} : { [LOG_PARAM]: log }) },
  };
}
