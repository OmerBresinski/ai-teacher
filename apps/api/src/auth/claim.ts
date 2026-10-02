/**
 * Claiming a signed-out lesson on sign-in (TEACH-224, rulings 109 and 112). The anonymous user's
 * Workspace is handed to the new account by changing `workspaces.owner_user_id`; no row moves, so
 * lesson ids, `/l/<id>` URLs and storage keys (`<workspaceId>/…`, checked by `GET /files/*`) stay
 * valid. `requireSession` resolves the Workspace by owner, so the next request sees the lesson.
 *
 * Two entry points, both of which log and never throw into the sign-in:
 * - `claimOnLink` — the anonymous plugin's `onLinkAccount`, when the anonymous cookie is on the
 *   browser that finishes sign-in.
 * - `writePendingClaim` at magic-link send time, then `claimPending` from
 *   `databaseHooks.session.create.after`, for a link opened on another device. The row is keyed
 *   by email, so the claim goes to whoever proves the inbox; no token rides in the callbackURL.
 *
 * The anonymous `users` row stays (`disableDeleteAnonymousUser`); `auth.anonymous-cleanup` in the
 * worker removes it after its TTL, and finds no Workspace to delete once this has run.
 *
 * Raw `db.sql` like `workspace-hook.ts`: `workspaces`, `users` and `verifications` are non-tenant
 * tables, and the "is the account in use" check counts `documents` and `sources` by
 * `workspace_id` across tenants on purpose (ADR 0007's non-tenant path, not `forWorkspace()`).
 */
import type { DbHandle } from "@tj/db";
import { newId, safeError } from "@tj/domain";
import { getSessionFromCtx } from "better-auth/api";
import type { Logger } from "../logger";

type Sql = Pick<DbHandle, "sql">;
/** better-auth's endpoint context, as `sendMagicLink` receives it. */
type EndpointContext = Parameters<typeof getSessionFromCtx>[0];

export type ClaimResult = "claimed" | "declined-existing" | "nothing-to-claim";
/** Which entry point reached the claim; logged beside the result. */
export type ClaimVia = "link" | "pending";

/** An account older than this is "existing" and never claims (ruling 112). */
export const NEW_ACCOUNT_MINUTES = 10;
/** How long a pending claim written at magic-link send time stays usable. */
export const PENDING_CLAIM_TTL_MINUTES = 60;
export const PENDING_CLAIM_PREFIX = "claim:";

export function pendingClaimIdentifier(email: string): string {
  return `${PENDING_CLAIM_PREFIX}${email.toLowerCase()}`;
}

/**
 * Hand `anonymousUserId`'s Workspace to `userId`, in one transaction:
 * - `nothing-to-claim` when the anonymous user owns no Workspace (already claimed, or deleted by
 *   the cleanup job), is not anonymous, or the target is missing, anonymous or the same user;
 * - `declined-existing` when the target was created more than `NEW_ACCOUNT_MINUTES` ago or its
 *   own Workspace holds any `documents` or `sources` row, soft-deleted ones included (ruling 112);
 * - otherwise `claimed`: the target's empty Workspace is deleted (the owner index is unique) and
 *   the anonymous one takes its place.
 *
 * Lock order is the anonymous Workspace, then the target's. Locking the anonymous Workspace first
 * makes a racing claim for the same visitor, or the cleanup job's delete, wait and then see it
 * gone. Locking the target's Workspace blocks a lesson being inserted into it (the FK check needs
 * a key-share lock on that row) between the emptiness check and the delete.
 */
export async function claimAnonymousWorkspace(
  db: Sql,
  { anonymousUserId, userId }: { anonymousUserId: string; userId: string },
): Promise<ClaimResult> {
  if (anonymousUserId === userId) return "nothing-to-claim";
  return db.sql.begin(async (tx): Promise<ClaimResult> => {
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

    const [own] = await tx<{ id: string; used: boolean }[]>`
      select w.id,
             exists (select 1 from documents d where d.workspace_id = w.id)
               or exists (select 1 from sources s where s.workspace_id = w.id) as used
      from workspaces w where w.owner_user_id = ${userId}
      for update of w`;
    if (own?.used) return "declined-existing";

    if (own) await tx`delete from workspaces where id = ${own.id}`;
    await tx`
      update workspaces set owner_user_id = ${userId}, updated_at = now()
      where id = ${source.id}`;
    return "claimed";
  });
}

/**
 * Run a claim, log one line with the result and both ids (never an email, ADR 0015), and swallow
 * any failure: a claim that cannot run must not cost the teacher the sign-in. The transaction has
 * rolled back by the time the error is logged.
 */
async function claimAndLog(
  db: Sql,
  logger: Pick<Logger, "info" | "error">,
  via: ClaimVia,
  ids: { anonymousUserId: string; userId: string },
): Promise<void> {
  try {
    const claim = await claimAnonymousWorkspace(db, ids);
    logger.info({ claim, via, ...ids }, "anonymous workspace claim");
  } catch (error) {
    logger.error({ via, ...ids, err: safeError(error) }, "anonymous workspace claim failed");
  }
}

/** The anonymous plugin's `onLinkAccount`: the same browser finished a sign-in. */
export function claimOnLink(
  db: Sql,
  logger: Pick<Logger, "info" | "error">,
  ids: { anonymousUserId: string; userId: string },
): Promise<void> {
  return claimAndLog(db, logger, "link", ids);
}

/**
 * Record that `anonymousUserId` asked for a magic link to `email`: one `verifications` row,
 * `claim:<email>` → the anonymous user id, valid for `PENDING_CLAIM_TTL_MINUTES`. A newer request
 * for the same address replaces the older row, so the last browser to ask wins.
 */
export async function writePendingClaim(
  db: Sql,
  { email, anonymousUserId }: { email: string; anonymousUserId: string },
): Promise<void> {
  const identifier = pendingClaimIdentifier(email);
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
  logger: Pick<Logger, "info" | "error">,
  ctx: EndpointContext,
  email: string,
): Promise<void> {
  try {
    const current = await getSessionFromCtx(ctx, { disableRefresh: true });
    if (current?.user.isAnonymous !== true) return;
    const anonymousUserId = current.user.id;
    await writePendingClaim(db, { email, anonymousUserId });
    logger.info({ anonymousUserId }, "pending claim written");
  } catch (error) {
    logger.error({ err: safeError(error) }, "pending claim write failed");
  }
}

/**
 * Take the pending claim for `userId`'s email, if any. One statement on every sign-in: a primary
 * key lookup for the email inside an indexed delete on `verifications.identifier`. Deleting
 * consumes the row, so two sessions created at once cannot both claim; an expired row is removed
 * and ignored. Should two rows exist (two sends racing), the newest live one counts.
 */
async function takePendingClaim(db: Sql, userId: string): Promise<string | undefined> {
  const rows = await db.sql<{ value: string }[]>`
    with taken as (
      delete from verifications
      where identifier =
        ${PENDING_CLAIM_PREFIX} || (select lower(email) from users where id = ${userId})
      returning value, expires_at, created_at
    )
    select value from taken where expires_at > now() order by created_at desc limit 1`;
  return rows[0]?.value;
}

/**
 * `databaseHooks.session.create.after`: complete a pending claim for the user who just signed in.
 * Runs for every session on every device (anonymous ones find nothing), so it is one query when
 * there is no claim, and it logs instead of throwing.
 */
export async function claimPending(
  db: Sql,
  logger: Pick<Logger, "info" | "error">,
  userId: string,
): Promise<void> {
  let anonymousUserId: string | undefined;
  try {
    anonymousUserId = await takePendingClaim(db, userId);
  } catch (error) {
    logger.error({ userId, err: safeError(error) }, "pending claim lookup failed");
    return;
  }
  if (anonymousUserId) await claimAndLog(db, logger, "pending", { anonymousUserId, userId });
}
