/**
 * Compile-time contract checks, run by `tsc --noEmit` (this file is under `src`). If any
 * `@ts-expect-error` below stops erroring, the RPC types have regressed (e.g. a router was not
 * chained) and `typecheck` fails.
 */
import type { InferResponseType } from "hono/client";
import { createApiClient } from "./index";

const client = createApiClient("http://localhost:3001");

// Known routes infer.
type HelloOk = InferResponseType<typeof client.hello.$get, 200>;
type HealthOk = InferResponseType<typeof client.health.$get, 200>;
const _hello: HelloOk = { message: "Hello, x" };
const _health: HealthOk = { ok: true, db: "up" };

// Unknown routes do not exist on the client.
// @ts-expect-error `nope` is not a route
client.nope;

// Query parameters are typed from the Zod schema.
// @ts-expect-error `name` must be a string
void client.hello.$get({ query: { name: 1 } });

// @ts-expect-error `name` is required
void client.hello.$get({ query: {} });

// Job routes (TEACH-19): body and params are typed from the Zod schemas.
type PingAccepted = InferResponseType<typeof client.jobs.ping.$post, 202>;
const _ping: PingAccepted = { jobId: "01a06a15-1849-7000-ac6a-c07e27fe308b" as never };
void client.jobs.ping.$post({ json: { message: "hi", steps: 3 } });
void client.jobs[":id"].cancel.$post({ param: { id: "01a06a15-1849-7000-ac6a-c07e27fe308b" } });
type CancelAccepted = InferResponseType<(typeof client.jobs)[":id"]["cancel"]["$post"], 202>;
const _cancel: CancelAccepted["status"] = "cancelling";

// @ts-expect-error `message` is required
void client.jobs.ping.$post({ json: { steps: 3 } });

// @ts-expect-error `steps` must be a number
void client.jobs.ping.$post({ json: { message: "hi", steps: "3" } });

// The worksheet routes (ADR 0030, TEACH-14): the body is typed from the domain schema and the
// two answers infer. `recipeId` is a string on the wire (an unknown recipe is the route's 422).
void client.lessons[":id"].worksheet.$post({
  param: { id: "01a06a15-1849-7000-ac6a-c07e27fe308b" },
  json: { expectedRevision: 1, recipeId: "exit-ticket", practiceMinutes: 10 },
});
type WorksheetAccepted = InferResponseType<
  (typeof client.lessons)[":id"]["worksheet"]["$post"],
  202
>;
const _worksheet: WorksheetAccepted = { worksheetId: "w", jobId: "j" as never };
type WorksheetsOk = InferResponseType<(typeof client.lessons)[":id"]["worksheets"]["$get"], 200>;
const _worksheets: WorksheetsOk["items"][number]["generatingJobId"] = null;

void client.lessons[":id"].worksheet.$post({
  param: { id: "01a06a15-1849-7000-ac6a-c07e27fe308b" },
  // @ts-expect-error `practiceMinutes` is one of the offered times or "auto"
  json: { expectedRevision: 1, practiceMinutes: 7 },
});

// The brief parse (ADR 0029 item 13, TEACH-16): `text` is required, `yearGroups` optional, and the
// answer is the brief fields plus what the model filled.
void client.briefs.parse.$post({
  json: { text: "Year 8 history: the causes of the First World War" },
});
void client.briefs.parse.$post({ json: { text: "fractions", yearGroups: ["Year 5"] } });
type ParsedBrief = InferResponseType<typeof client.briefs.parse.$post, 200>;
const _parsed: ParsedBrief = {
  topic: "the causes of the First World War",
  yearGroup: "Year 8",
  subject: "History",
  level: "standard",
  durationMin: 50,
  inferred: ["level"],
};
const _parsedLevel: ParsedBrief["level"] = "harder";

// @ts-expect-error `text` is required
void client.briefs.parse.$post({ json: { yearGroups: ["Year 5"] } });

// @ts-expect-error `level` is one of the brief levels
const _badLevel: ParsedBrief["level"] = "hardest";
