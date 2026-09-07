/**
 * Test-only routes (TEACH-22, TEACH-121). Mounted by `app.ts` **only** when `testRoutesEnabled(env)`:
 * `NODE_ENV === "test"` *and* `ENABLE_TEST_ROUTES=1`. `env.ts` additionally refuses to boot with
 * `ENABLE_TEST_ROUTES` set in production, so these can never reach a deployed api.
 *
 * - `GET /__test/last-magic-link?email=…` — the last magic link the api "sent" to `email`, read
 *   from the in-memory `CaptureMailSender`. Playwright's `signedInPage` fixture uses it to sign in
 *   without a mailbox.
 * - `POST /__test/seed-library` — insert documents into the **caller's** Workspace (ADR 0024 §16:
 *   Workspaces start empty, seeding is a test concern). The body carries the fixtures — the e2e
 *   fixture posts `demoWorkspace()` from `@tj/editor/starter`, so the api does not depend on the
 *   editor — and `seedDocuments` in `@tj/db` inserts them through the repository, mapping series
 *   lesson keys to the minted ids. Answers `{ ids: { [key]: uuid } }` so a spec can address
 *   `/l/${ids["demo-water-cycle"]}`. `app.ts` puts this path behind the CSRF and session guards.
 *
 * Neither route is part of `AppType` (they never reach the RPC client types).
 */
import { zValidator } from "@hono/zod-validator";
import { forWorkspace, type ScopableDb, seedDocuments } from "@tj/db";
import { DocumentKindSchema, DocumentParseError } from "@tj/domain/documents";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { errorResponse } from "../errors";
import { type CaptureMailSender, extractFirstUrl } from "../mail";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { documentBodyLimit } from "./documents";

export type TestRoutesEnv = Pick<Env, "NODE_ENV"> & Partial<Pick<Env, "ENABLE_TEST_ROUTES">>;

/** The single place that decides whether test routes exist in this process. */
export function testRoutesEnabled(env: TestRoutesEnv): boolean {
  return env.NODE_ENV === "test" && env.ENABLE_TEST_ROUTES === "1";
}

const lastMagicLinkQuery = z.object({ email: z.email() });

/** The shape `seedDocuments` needs; the repository validates each body as its kind. */
const seedBody = z.object({
  documents: z
    .array(
      z.object({
        key: z.string().min(1),
        kind: DocumentKindSchema,
        // Loose: the rest of the body is the document itself, validated by the repository.
        body: z.looseObject({
          id: z.string(),
          title: z.string(),
          createdAt: z.iso.datetime(),
          updatedAt: z.iso.datetime(),
          lessonIds: z.array(z.string()).optional(),
        }),
        generatingJobId: z.uuid().optional(),
      }),
    )
    .max(200),
});

export function testRoutes(mail: CaptureMailSender, unsafeDb: ScopableDb) {
  return new Hono<AppEnv>()
    .get(
      "/__test/last-magic-link",
      zValidator("query", lastMagicLinkQuery, validationHook),
      (c) => {
        const { email } = c.req.valid("query");
        const message = mail.lastFor(email);
        const url = message ? extractFirstUrl(message.text) : undefined;
        if (!message || !url) {
          return errorResponse(
            c,
            404,
            "not_found",
            "No magic link has been sent to that address.",
            false,
          );
        }
        return c.json({ email: message.to, url }, 200);
      },
    )
    .post(
      "/__test/seed-library",
      documentBodyLimit(),
      requireJsonBody(),
      zValidator("json", seedBody, validationHook),
      async (c) => {
        const ws = forWorkspace(unsafeDb, getWorkspaceId(c, { allowHeaderShim: false }));
        const { documents } = c.req.valid("json");
        const result = await seedDocuments(ws, documents).catch((error: unknown) => {
          if (error instanceof DocumentParseError) {
            throw new HTTPException(422, { message: error.message });
          }
          throw error;
        });
        c.get("logger")?.info(
          { workspaceId: ws.workspaceId, inserted: result.inserted.length },
          "test seed inserted documents",
        );
        return c.json({ ids: Object.fromEntries(result.ids) }, 201);
      },
    );
}
