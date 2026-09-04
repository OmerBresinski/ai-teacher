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
