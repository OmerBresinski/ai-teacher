/** `GET /hello?name=…` — the smallest validated route; the RPC inference reference example. */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { validationHook } from "../validation";

const helloQuery = z.object({ name: z.string().min(1) });

export const helloRoutes = new Hono<AppEnv>().get(
  "/hello",
  zValidator("query", helloQuery, validationHook),
  (c) => {
    const { name } = c.req.valid("query");
    return c.json({ message: `Hello, ${name}` }, 200);
  },
);
