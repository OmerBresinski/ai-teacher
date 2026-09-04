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
