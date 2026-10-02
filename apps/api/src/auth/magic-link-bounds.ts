/**
 * Bounds on magic-link email (TEACH-300). Turnstile and the per-IP limiters bound automated
 * requests, but not sends to one address by a person or a captcha solver, so `sendMagicLink`
 * asks here first:
 *
 * - at most `MAGIC_LINK_SENDS_PER_RECIPIENT_HOURLY` sends to one address per rolling hour;
 * - at most `MAGIC_LINK_SENDS_DAILY_CAP` sends per UTC day across every address.
 *
 * Over either bound the send (and its pending claim) is skipped and better-auth still answers
 * `{ status: true }`, exactly like a send, so the response never says whether an address was
 * bounded. Rows live in `magic_link_sends`, keyed by an HMAC of the lower-cased address under
 * `BETTER_AUTH_SECRET` (the `pendingClaimIdentifier` idea in `claim.ts`), so the table never holds
 * an address. A send is counted when admitted, before the mail goes out: a failed send still
 * costs a slot, which errs on the bounded side. Like the anonymous counters it is a soft count:
 * concurrent requests can pass the check together.
 */
import { createHmac } from "node:crypto";
import type { DbHandle } from "@tj/db";
import type { Env } from "../env";

type Sql = Pick<DbHandle, "sql">;

export type MagicLinkBoundsEnv = Partial<
  Pick<Env, "MAGIC_LINK_SENDS_PER_RECIPIENT_HOURLY" | "MAGIC_LINK_SENDS_DAILY_CAP">
>;

export const DEFAULT_SENDS_PER_RECIPIENT_HOURLY = 5;
export const DEFAULT_SENDS_DAILY_CAP = 300;

export function magicLinkBounds(env: MagicLinkBoundsEnv): {
  perRecipientHourly: number;
  dailyCap: number;
} {
  return {
    perRecipientHourly:
      env.MAGIC_LINK_SENDS_PER_RECIPIENT_HOURLY ?? DEFAULT_SENDS_PER_RECIPIENT_HOURLY,
    dailyCap: env.MAGIC_LINK_SENDS_DAILY_CAP ?? DEFAULT_SENDS_DAILY_CAP,
  };
}

/** The `magic_link_sends.recipient` key for `email`: an HMAC, never the address. */
export function magicLinkRecipientKey(secret: string, email: string): string {
  return createHmac("sha256", secret)
    .update(`magic-link-send:${email.toLowerCase()}`)
    .digest("base64url");
}

export interface MagicLinkAdmission {
  admitted: boolean;
  /** Sends to this address in the last hour, before this one. */
  recipientCount: number;
  /** Sends since UTC midnight, before this one. */
  dailyCount: number;
}

/** Count one send to `email` if both bounds allow it, in one statement. */
export async function admitMagicLinkSend(
  db: Sql,
  {
    secret,
    email,
    perRecipientHourly,
    dailyCap,
  }: { secret: string; email: string; perRecipientHourly: number; dailyCap: number },
): Promise<MagicLinkAdmission> {
  const recipient = magicLinkRecipientKey(secret, email);
  const rows = await db.sql<MagicLinkAdmission[]>`
    with counts as (
      select
        (select count(*)::int from magic_link_sends
          where recipient = ${recipient} and sent_at > now() - interval '1 hour') as recipient,
        (select count(*)::int from magic_link_sends
          where sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as daily
    ), admitted as (
      insert into magic_link_sends (recipient)
      select ${recipient} from counts
      where counts.recipient < ${perRecipientHourly} and counts.daily < ${dailyCap}
      returning 1
    )
    select
      exists (select 1 from admitted) as admitted,
      counts.recipient as "recipientCount",
      counts.daily as "dailyCount"
    from counts
  `;
  return rows[0] ?? { admitted: false, recipientCount: 0, dailyCount: 0 };
}
