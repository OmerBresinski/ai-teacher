/**
 * Claiming a signed-out lesson on sign-in (TEACH-224, rulings 109 and 112). The anonymous user's
 * Workspace is handed to the new account by changing `workspaces.owner_user_id`; no row moves, so
 * lesson ids, `/l/<id>` URLs and storage keys (`<workspaceId>/…`, checked by `GET /files/*`) stay
 * valid. `requireSession` resolves the Workspace by owner, so the next request sees the lesson.
 *
 * Two entry points, both of which log and never throw into the sign-in:
 * - `claimOnLink` — the anonymous plugin's `onLinkAccount`, when the anonymous cookie is on the
 *   browser that finishes sign-in.
 * - `recordPendingClaim` at magic-link send time, then `claimPending` from
 *   `databaseHooks.session.create.after`, for a link opened on another device. The row is keyed
 *   by email, so the claim goes to whoever proves the inbox; no token rides in the callbackURL.
 *   The browser's own anonymous lesson wins over a pending row.
 *
 * The anonymous `users` row stays (`disableDeleteAnonymousUser`) but is signed out everywhere;
 * `auth.anonymous-cleanup` in the worker removes it after its TTL, and finds no Workspace to
 * delete once this has run.
 *
 * Raw `db.sql` like `workspace-hook.ts`: `workspaces`, `users`, `sessions` and `verifications` are
 * non-tenant tables, and the "is the account in use" check counts `documents` and `sources` by
 * `workspace_id` across tenants on purpose (ADR 0007's non-tenant path, not `forWorkspace()`).
 */
import { createHmac } from "node:crypto";
import type { DbHandle } from "@tj/db";
import { newId, safeError } from "@tj/domain";
import { getSessionFromCtx } from "better-auth/api";
import type { Logger } from "../logger";

type Sql = Pick<DbHandle, "sql">;
/** The postgres.js transaction handle `db.sql.begin` passes to its callback. */
type Tx = Parameters<Parameters<DbHandle["sql"]["begin"]>[1]>[0];
/** better-auth's endpoint context, as `sendMagicLink` and the database hooks receive it. */
type EndpointContext = Parameters<typeof getSessionFromCtx>[0];
type ClaimLogger = Pick<Logger, "info" | "error">;
type ClaimIds = { anonymousUserId: string; userId: string };

export type ClaimResult = "claimed" | "declined-existing" | "nothing-to-claim";
/** Which entry point reached the claim; logged beside the result. */
export type ClaimVia = "link" | "pending";

/** An account older than this is "existing" and never claims (ruling 112). */
export const NEW_ACCOUNT_MINUTES = 10;
/** How long a pending claim written at magic-link send time stays usable. */
export const PENDING_CLAIM_TTL_MINUTES = 60;
export const PENDING_CLAIM_PREFIX = "claim:";

/**
 * The pending row's `verifications.identifier`: `claim:` and an HMAC of the lower-cased address
 * under the auth secret. Never the address itself: `GET /auth/magic-link/verify?token=<identifier>`
 * consumes any `verifications` row by identifier, so a guessable one could be deleted by anyone
 * who knows the address. It also keeps the address out of the table.
 */
export function pendingClaimIdentifier(secret: string, email: string): string {
  const mac = createHmac("sha256", secret)
    .update(`pending-claim:${email.toLowerCase()}`)
    .digest("base64url");
  return `${PENDING_CLAIM_PREFIX}${mac}`;
}

/**
 * Hand `anonymousUserId`'s Workspace to `userId` in one transaction (see `handOver`):
 * - `nothing-to-claim` when the anonymous user owns no Workspace (already claimed, or deleted by
 *   the cleanup job), is not anonymous, or the target is missing, anonymous or the same user;
 * - `declined-existing` when the target was created more than `NEW_ACCOUNT_MINUTES` ago or its
 *   own Workspace holds any `documents` or `sources` row, soft-deleted ones included (ruling 112);
 * - otherwise `claimed`.
 */
export function claimAnonymousWorkspace(db: Sql, ids: ClaimIds): Promise<ClaimResult> {
  if (ids.anonymousUserId === ids.userId) return Promise.resolve("nothing-to-claim");
  return db.sql.begin((tx) => handOver(tx, ids));
}

/**
 * The claim inside a caller's transaction. On `claimed` the target's empty Workspace is deleted
 * (the owner index is unique), the anonymous one takes its place, and the anonymous user's
 * sessions are deleted.
 *
 * Lock order is the anonymous Workspace, then the target's. Locking the anonymous Workspace first
 * makes a racing claim for the same visitor, or the cleanup job's cascade, wait and then see it
 * gone. The target's Workspace is locked before it is checked for content: a lesson insert needs a
 * key-share lock on that row for its foreign key, so once the lock is held no insert can land, and
 * the check (a new statement, so a new snapshot) sees any insert that committed while it waited.
 */
async function handOver(tx: Tx, { anonymousUserId, userId }: ClaimIds): Promise<ClaimResult> {
  const [source] = await tx<{ id: string }[]>`
    select w.id from workspaces w
    join users u on u.id = w.owner_user_id
    where w.owner_user_id = ${anonymousUserId} and u.is_anonymous
    for update of w`;
  if (!source) return "nothing-to-claim";

  const [target] = await tx<{ anonymous: boolean; isNew: boolean }[]>`
    select is_anonymous as anonymous,
           created_at > now() - make_interval(mins => ${NEW_ACCOUNT_MINUTES}) as "isNew"
    from users where id = ${userId}`;
  if (!target || target.anonymous) return "nothing-to-claim";
  if (!target.isNew) return "declined-existing";

  const [own] = await tx<{ id: string }[]>`
    select id from workspaces where owner_user_id = ${userId} for update`;
  if (own) {
    const [content] = await tx<{ used: boolean }[]>`
      select exists (select 1 from documents where workspace_id = ${own.id})
          or exists (select 1 from sources where workspace_id = ${own.id}) as used`;
    if (content?.used) return "declined-existing";
    await tx`delete from workspaces where id = ${own.id}`;
  }
  await tx`
    update workspaces set owner_user_id = ${userId}, updated_at = now()
    where id = ${source.id}`;
  // Sign the anonymous user out everywhere. An open `/events` stream is bound to the Workspace id
  // it connected with and re-checks only its session, and a live anonymous session would heal
  // itself a fresh Workspace (with a fresh lesson allowance) on its next request.
  await tx`delete from sessions where user_id = ${anonymousUserId}`;
  return "claimed";
}

/**
 * The anonymous plugin's `onLinkAccount`: the same browser finished a sign-in. Logs one line with
 * the result and both ids (never an email, ADR 0015) and swallows any failure, after the
 * transaction has rolled back: a claim that cannot run must not cost the teacher the sign-in.
 */
export async function claimOnLink(db: Sql, logger: ClaimLogger, ids: ClaimIds): Promise<void> {
  try {
    const claim = await claimAnonymousWorkspace(db, ids);
    logger.info({ claim, via: "link", ...ids }, "anonymous workspace claim");
  } catch (error) {
    logger.error(
      { via: "link", ...ids, err: safeError(error) },
      "anonymous workspace claim failed",
    );
  }
}

/**
 * Record that `anonymousUserId` asked for a magic link to `email`: one `verifications` row,
 * `pendingClaimIdentifier` → the anonymous user id, valid for `PENDING_CLAIM_TTL_MINUTES`. A newer
 * request for the same address replaces the older row, so the last browser to ask wins.
 */
export async function writePendingClaim(
  db: Sql,
  { secret, email, anonymousUserId }: { secret: string; email: string; anonymousUserId: string },
): Promise<void> {
  const identifier = pendingClaimIdentifier(secret, email);
  await db.sql.begin(async (tx) => {
    await tx`delete from verifications where identifier = ${identifier}`;
    await tx`
      insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
      values (${newId()}, ${identifier}, ${anonymousUserId},
              now() + make_interval(mins => ${PENDING_CLAIM_TTL_MINUTES}), now(), now())`;
  });
}

/**
 * `sendMagicLink`: when the browser asking for the link is signed in anonymously, write the
 * pending claim. A failure is logged and the link is still sent; the sign-in matters more than
 * the claim, and the same browser can still claim through `onLinkAccount`.
 */
export async function recordPendingClaim(
  db: Sql,
  logger: ClaimLogger,
  { secret, ctx, email }: { secret: string; ctx: EndpointContext; email: string },
): Promise<void> {
  try {
    const current = await getSessionFromCtx(ctx, { disableRefresh: true });
    if (current?.user.isAnonymous !== true) return;
    const anonymousUserId = current.user.id;
    await writePendingClaim(db, { secret, email, anonymousUserId });
    logger.info({ anonymousUserId }, "pending claim written");
  } catch (error) {
    logger.error({ err: safeError(error) }, "pending claim write failed");
  }
}

/**
 * Whether the request finishing this sign-in carries a live anonymous session whose Workspace
 * holds a lesson. The anonymous plugin's `onLinkAccount` then claims that browser's own lesson; it
 * runs after the database hooks, so a pending row (which anyone can point at an address) must not
 * get there first. An anonymous session with nothing in it does not outrank the row, so a phone
 * that never made a lesson still receives the laptop's. The cost, accepted with the address-keyed
 * row (ADR 0008 amendment, TEACH-249): a newer row someone else pointed at the address also beats
 * an empty session, and that visitor gets the other browser's lesson; nothing is read or taken.
 * (Anonymous users cannot upload sources, so documents are the whole test.)
 */
async function browserHasAnonymousLesson(
  db: Sql,
  ctx: EndpointContext | null | undefined,
): Promise<boolean> {
  if (!ctx) return false;
  const token = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  );
  if (!token) return false;
  const rows = await db.sql`
    select 1 from sessions s
    join users u on u.id = s.user_id
    join workspaces w on w.owner_user_id = u.id
    where s.token = ${token} and u.is_anonymous and s.expires_at > now()
      and exists (select 1 from documents d where d.workspace_id = w.id)`;
  return rows.length > 0;
}

/**
 * `databaseHooks.session.create.after`: complete a pending claim for the user who just signed in.
 * It runs for every session on every device: an anonymous sign-in returns at once, any other costs
 * two indexed lookups (the email by primary key, then the pending row) when there is no claim.
 *
 * Taking the row and claiming are one transaction, so a claim that fails leaves the row for the
 * next sign-in within its hour; deleting it consumes it, so two sessions cannot both claim, and
 * the newest live row wins should two sends have raced. When the browser has its own anonymous
 * lesson the row is dropped as `superseded` and `onLinkAccount` claims instead. Logs ids only and
 * never throws.
 */
export async function claimPending(
  db: Sql,
  logger: ClaimLogger,
  { secret, userId, ctx }: { secret: string; userId: string; ctx: EndpointContext | null },
): Promise<void> {
  if (ctx?.path === "/sign-in/anonymous") return;
  let anonymousUserId: string | undefined;
  try {
    const [user] = await db.sql<{ email: string }[]>`select email from users where id = ${userId}`;
    if (!user) return;
    const identifier = pendingClaimIdentifier(secret, user.email);
    const waiting = await db.sql`select 1 from verifications where identifier = ${identifier}`;
    if (waiting.length === 0) return;

    const sameBrowser = await browserHasAnonymousLesson(db, ctx);
    const claim = await db.sql.begin(async (tx) => {
      const [taken] = await tx<{ value: string }[]>`
        with taken as (
          delete from verifications where identifier = ${identifier}
          returning value, expires_at, created_at
        )
        select value from taken where expires_at > now() order by created_at desc limit 1`;
      if (!taken) return undefined;
      anonymousUserId = taken.value;
      if (sameBrowser) return "superseded" as const;
      return handOver(tx, { anonymousUserId: taken.value, userId });
    });
    if (claim) {
      logger.info({ claim, via: "pending", anonymousUserId, userId }, "anonymous workspace claim");
    }
  } catch (error) {
    logger.error(
      { via: "pending", anonymousUserId, userId, err: safeError(error) },
      "anonymous workspace claim failed",
    );
  }
}
