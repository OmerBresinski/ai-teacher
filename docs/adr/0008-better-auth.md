# 0008 — better-auth for identity

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F17-R01 (magic link, Google/Microsoft; passkeys V1), F15-D3 (teacher identity is the only personal data), F17-R12 (account deletion)

## Context

Teacher identity (email, name) is the only personal data the product holds by design. Hosted identity providers would move that data to a third party and add cost; F17 needs magic links, Google and Microsoft OAuth now and passkeys in V1.

## Decision

`better-auth` runs inside `apps/api` with the Drizzle adapter; its tables live in `packages/db`. The scaffold enables email magic link only, with Google and Microsoft OAuth wired but gated behind environment variables (credentials arrive with the F17 project). Sessions are cookie-based. A `requireSession` Hono middleware resolves the user and their personal workspace and attaches both to the request context.

## Consequences

- **Amendment (TEACH-283, 2026-09-13): authoritative protected requests.** `requireSession`
  always calls `getSession` with `query: { disableCookieCache: true }`. The cookie cache may serve
  non-authoritative display lookups; it cannot authorize protected reads, writes or SSE. A deleted
  session row invalidates even a replayed, correctly signed cache cookie. SSE retains its initial
  session id/expiry and a server-owned authoritative revalidator (ADR 0012 amendment below).

- Identity data stays in our database, in the same region as everything else.
- The web app is on a different origin from the API (ADR 0010); cookies must be `Secure; SameSite=None` or both apps must share a parent domain. The scaffold uses a shared parent domain (`app.<domain>` and `api.<domain>`) and sets the cookie domain accordingly; local development uses a Vite dev proxy so both appear same-origin.
- Passkeys are a plugin addition in V1 with no architectural change.
- **Amendment (TEACH-24, 2026-09-04) — interim `SameSite=None`.** Until a domain is bought, the web app and the api live on unrelated hosts (`*.vercel.app`, `*.up.railway.app`), so the shared-parent-domain cookie is impossible. Production therefore runs with `COOKIE_SAMESITE=none` (`__Secure-tj.session_token …; Secure; SameSite=None`, verified end-to-end: magic link → 302 to the Vercel origin → `/me` 200), with CORS (`WEB_ORIGIN`/`WEB_ORIGIN_PATTERNS`) and better-auth's `trustedOrigins` bounding cross-site requests. Protected API routes independently reject non-allow-listed origins with the same allow-list; CORS alone does not prevent CSRF. This is the same setting Railway PR environments need against Vercel previews. The decision above remains the target: once `app.<domain>`/`api.<domain>` exist, set `COOKIE_DOMAIN=.<domain>` and `COOKIE_SAMESITE=lax` (`infra/README.md`, post-provisioning checklist).
- **Amendment (TEACH-36, 2026-09-12) — the stopgap is closed.** The interim `SameSite=None` cookie failed on every iOS browser: WebKit's ITP blocks third-party cookies outright, so `/me` after the magic-link redirect was 401 and the app bounced to `/sign-in` on mobile while desktop Chrome worked. Production is now `app.bresinski.org` (Vercel) and `api.bresinski.org` (Railway) with `COOKIE_DOMAIN=.bresinski.org`, `COOKIE_SAMESITE=lax` — the original decision, on the founder's existing domain rather than a purchased product domain (swapping is three DNS records and four variables). `effectiveCookieDomain()` in `apps/api/src/auth/auth.ts` ignores `COOKIE_DOMAIN` when `BETTER_AUTH_URL` is not under it, so a Railway PR environment that inherits the production value falls back to a host-only cookie instead of one the browser drops. `none` remains the Vercel-preview ↔ PR-api mode only.

## Amendment (2026-09-27, TEACH-15): Google sign-in

Project **Google sign-in** turns on the Google half of the wiring above. Decided in a design review
with the founder; the tickets (TEACH-311, TEACH-312, TEACH-31) implement it and do not reopen it.

1. **Google only.** Microsoft stays wired and off. An Entra ID email claim can be unverified, so
   Microsoft needs its own linking rule and its own review before it is switched on (F17).
2. **The same verified email is the same user.** A Google sign-in whose email matches an existing
   user links to that user and its personal Workspace. This is better-auth 1.7.2's default
   (`handleOAuthUserInfo` in `better-auth/dist/oauth2/link-account.mjs` links when the provider
   says `email_verified` and the local user is verified); magic-link users are created with
   `emailVerified: true`, so no linking option changes. Either method works afterwards.
3. **No Google tokens are stored.** Sign-in needs the identity only. `databaseHooks.account`
   `create.before` and `update.before` null the access, refresh and id tokens before any
   `accounts` write, and `account.updateAccountOnSignIn: false` stops sign-ins from rewriting
   them. A future feature that calls Google APIs needs new scopes and fresh consent anyway, which
   yields new tokens then.
4. **Name and photo URL are stored.** A user created through Google gets Google's name and
   picture URL in `users.name` / `users.image`. A magic-link user (created with `name: ""`) gets
   both once, when they link Google (`account.accountLinking.updateUserInfoOnLink: true`); later
   sign-ins leave them alone (`overrideUserInfoOnSignIn` stays off). Nothing displays the photo
   yet. The photo URL goes beyond F15-D3; ADR 0016 item 6 records the deviation.
5. **Production and local development only.** One Google Cloud project, owned by the founder's
   Google account, holds two Web OAuth clients: production
   (`https://api.bresinski.org/auth/callback/google`) and local
   (`http://localhost:3001/auth/callback/google`). Railway PR environments get no Google sign-in:
   Google accepts no wildcard redirect URIs, and a PR api that inherits the production client
   gets Google's `redirect_uri_mismatch`. That is accepted while Vercel previews are off;
   better-auth's `oAuthProxy` plugin is the option if they come back.
6. **`/sign-in` always shows "Continue with Google"**, above the email form with an "or" divider.
   The web does not ask the api which providers are on; when the api has no Google provider
   (`POST /auth/sign-in/social` answers 404 `PROVIDER_NOT_FOUND`) the page says so. A cancelled or
   failed Google round trip returns to `/sign-in` with a message and the original `redirect`;
   the failures better-auth would send to its own `/auth/error` page (missing or unknown state,
   database errors) go to the web's `/sign-in` too (`onAPIError.errorURL`).
7. **Order of switching on.** The token-dropping api change lands before any credential exists,
   because setting `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` turns Google on at the api. The same
   change adds the `accounts.issuer` column (unique with `account_id`) that better-auth 1.7.2's
   account model requires; the P0 schema lacks it, and magic links never write `accounts`, so
   until then every OAuth callback fails with `internal_server_error`. The button lands after
   production has credentials; a `smoke:prod` case proves the api returns a Google URL.
8. **Console-only steps.** Google has no API or gcloud command for a standard Web OAuth client or
   for the consent screen (the IAP OAuth Admin API behind `gcloud iap oauth-clients` shut down on
   2026-03-19). The consent screen and the clients are created in the Google Cloud console;
   everything else is scripted. Runbook: `infra/README.md`, "Google sign-in (Google Cloud)".

## Amendment (2026-09-28, TEACH-246): magic links survive mail scanners

School mail filters (Microsoft Defender Safe Links and similar) GET every link in an email before
the teacher sees it, and better-auth consumes the single-use token on the first
`GET /auth/magic-link/verify`, so the teacher's own click failed with `INVALID_TOKEN`. The email
now links to the web page `/sign-in/confirm?token=…&callbackURL=…&errorCallbackURL=…`
(`confirmPageUrl` in `apps/api/src/auth/magic-link-mail.ts`), on the callback's origin when
better-auth trusts it and on `WEB_ORIGIN[0]` otherwise. The page makes no request on load and holds
no link to the verify URL; its "Sign in" button sanitises both callbacks to same-origin paths and
navigates the window to the verify URL, so the cookie is set exactly as before and better-auth's
origin check still runs. Links last 15 minutes (`expiresIn: 900`) instead of 5. A scanner that
runs JavaScript and presses buttons would still spend the token; that is accepted.
Links sent just before a domain switch point at the old web host, so that host must keep serving
(or redirect with the query string intact) for at least the 15-minute expiry. The confirm page is
served with `Referrer-Policy: no-referrer` so the token never leaves in a Referer header.

## Amendment (2026-09-28, TEACH-206): Microsoft sign-in

Greg approved switching Microsoft on. This amendment gives it the linking rule the Google
amendment's item 1 asked for, and replaces that item and item 6 for Microsoft only.

1. **Any Microsoft account.** Work or school (Entra ID) and personal accounts: `tenantId:
   "common"`. The app registration's supported account types match ("Accounts in any
   organizational directory and personal Microsoft accounts"). `prompt: "select_account"`, so a
   shared classroom PC never signs the next teacher in as the last one.
2. **Verified email only.** Entra sends no `email_verified`, and a tenant admin can put any address
   in a user's `mail`. The api therefore treats a Microsoft email as verified only when the id
   token's `tid` is the personal-account tenant (`9188040d-6c67-4c5b-b112-36a304b66dad`) or the
   optional claim `xms_edov` ("email domain owner verified") is true; the app registration adds
   `email` and `xms_edov` to the ID token. Any other Microsoft sign-in is refused before
   better-auth sees it (`getUserInfo` returns `null`), so it creates no user and links nothing:
   better-auth 1.7.2 would otherwise create a user for an unverified address, letting a tenant
   admin pre-create an account for someone else's email. The browser returns to `/sign-in` with
   `error=unable_to_get_user_info`. A verified email links to an existing user as Google's does
   (item 2 above).
3. **Identity only.** Scopes `openid profile email`; no `User.Read`, no `offline_access`, no Graph
   photo (better-auth would store it as a base64 `users.image`). Tokens are dropped as in item 3.
4. **Production and local development only**, as item 5: one Entra app registration with the
   redirect URIs `https://api.<domain>/auth/callback/microsoft` and
   `http://localhost:3001/auth/callback/microsoft`. PR environments get no Microsoft sign-in.
5. **The web asks.** `GET /auth-providers` (public) answers `{ google, microsoft }` from the live
   better-auth instance. `/sign-in` shows "Continue with Microsoft", under Google, only when it
   says `microsoft: true`; a failed or pending request hides it. Google keeps item 6. The
   Microsoft error callback adds `via=microsoft` so the page's copy names Microsoft.

## Amendment (2026-10-02, TEACH-249): anonymous sessions and the first signed-out lesson

Project **First lesson before sign-in** lets a visitor make a lesson before signing in (rulings 109
to 112). TEACH-222, TEACH-223, TEACH-224, TEACH-243 and TEACH-244 built it; this records the
engineering decisions. The magic link itself (the confirm page and the 15-minute expiry) is the
TEACH-246 amendment above and is not repeated here.

1. **Anonymous users.** better-auth's `anonymous` plugin (`apps/api/src/auth/auth.ts`) answers
   `POST /auth/sign-in/anonymous` with a new user and an ordinary session cookie. The user is marked
   by `users.is_anonymous` (`packages/db/src/schema/auth.ts`, migration
   `0009_users_is_anonymous.sql`), and `GET /me` reports `isAnonymous`
   (`apps/api/src/routes/me.ts`). It gets its personal Workspace from the same
   `databaseHooks.user.create.after` hook as every other user, so the lesson routes need no second
   code path. Anonymous sign-in is always on; there is no feature flag. The brakes are items 5, 6
   and 8.
2. **The anonymous user is not deleted on link.** `disableDeleteAnonymousUser: true` (`auth.ts`). By
   default the plugin deletes the anonymous user when the browser signs in to a real account.
   `workspaces.owner_user_id` cascades on delete (`packages/db/src/schema/workspaces.ts`), so the
   Workspace and its lessons would go with it before the claim could hand them over. The anonymous
   `users` row stays until the cleanup job (item 7).
3. **The claim hands the Workspace over.** `claimAnonymousWorkspace` (`apps/api/src/auth/claim.ts`)
   changes `workspaces.owner_user_id` from the anonymous user to the new account in one transaction.
   No row moves: storage keys start with the Workspace id (`<workspaceId>/…`, checked by
   `GET /files/*` in `apps/api/src/routes/files.ts`), so lesson ids, `/l/<id>` URLs and pictures
   stay valid. The new account's own empty Workspace is deleted first, because each user owns one.
   The anonymous user's sessions are deleted in the same transaction: an open `/events` stream
   re-checks only its session, and a live anonymous session would otherwise get a fresh Workspace,
   with a fresh lesson allowance, on its next request.
   - **New accounts only (ruling 112).** An account created more than 10 minutes ago
     (`NEW_ACCOUNT_MINUTES`), or whose Workspace holds any document or source, declines. The lessons
     then stay with the anonymous user until the cleanup job.
   - **Same browser.** The plugin's `onLinkAccount` calls `claimOnLink` (`auth.ts`). better-auth
     runs it after any sign-in that sets a session on a browser holding an anonymous session: the
     magic-link verify, and the Google and Microsoft callbacks (the plugin carries the anonymous
     user id in the OAuth state).
   - **Another device.** `sendMagicLink` calls `recordPendingClaim`. When the browser asking for the
     link is anonymous, it writes one `verifications` row. The identifier is `claim:` plus an
     HMAC-SHA256 of the lower-cased address under `BETTER_AUTH_SECRET` (`pendingClaimIdentifier`),
     the value is the anonymous user id, and the row lasts one hour (`PENDING_CLAIM_TTL_MINUTES`). A
     newer send for the same address replaces it. The identifier is not the plain address:
     better-auth's `GET /auth/magic-link/verify?token=…` consumes any `verifications` row by
     identifier, so anyone who knows the address could delete a guessable row. The HMAC also keeps
     the address out of the table. `databaseHooks.session.create.after` calls `claimPending` on
     every sign-in on every device except an anonymous one. It takes the row and hands over in one
     transaction, so a claim that fails keeps its row for the next sign-in within the hour. The
     claim goes to whoever proves the inbox; no token rides in the callback URL.
   - **The browser's own lesson wins.** better-auth runs `session.create.after` before the plugin's
     `onLinkAccount`. When the browser finishing sign-in holds a live anonymous session whose
     Workspace has a lesson, `claimPending` drops the pending row (`superseded`) and `onLinkAccount`
     claims that browser's lesson. An anonymous session with no lesson does not outrank the row, so
     a phone that never made a lesson still receives the laptop's.
   - **A dead session cookie.** After a claim from another device, the first browser still holds a
     cookie for a deleted session, and for up to five minutes a signed cookie cache. While the cache
     lasts, better-auth answers its next anonymous sign-in with 400
     `ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY`. After that, the dead token makes
     better-auth's own session lookup expire the new session's cookies in the same response.
     `anonymousSignInDropsDeadSession` (`auth.ts`), a `hooks.before` on `/sign-in/anonymous`,
     removes the session cookies from that request when the token names no live session, so the
     browser gets a working anonymous session again.
   - **Accepted limitation.** Someone who knows an address can replace its pending row within the
     hour by asking for a magic link to it from their own anonymous session. Cross-device, or when
     the visitor's anonymous session holds no lesson, the visitor then gets the other browser's
     lesson instead of their own; theirs stays with the anonymous user until the cleanup job.
     Nothing is read or taken: proving the inbox can only receive a lesson. Binding the claim to the
     magic-link token would close this, at the cost of "any sign-in within the hour" (for example
     Google on another device).
4. **What an anonymous session may do.** `anonymousGuard` (`apps/api/src/auth/anonymous-guard.ts`)
   runs on every protected path after `requireSession` (`apps/api/src/app.ts`), so a request with no
   session is still 401 first. For an anonymous user it is default deny: reads (`GET`, `HEAD`,
   `OPTIONS`) pass, and so do the writes in `ANONYMOUS_WRITE_ALLOW_LIST`: `POST /lessons`,
   `POST /lessons/:id/plan`, `POST /lessons/:id/generate` and `POST /jobs/:id/cancel`. Every other
   write is 403 `sign_in_required`, so a route added later stays closed to anonymous users until
   someone lists it. Ownership is still each route's `forWorkspace()` scoping. The quotas live in
   `apps/api/src/routes/lessons.ts`:
   - `POST /lessons`: two lessons per Workspace (`ANONYMOUS_LESSON_LIMIT`, ruling 111), then 403
     `anonymous_limit`; then the daily cap (item 6), 403 `anonymous_capacity`. Anonymous creates for
     one Workspace run one at a time (`createKeyedQueue` in `anonymous-limits.ts`). The queue is per
     process; a second api replica would need a row lock.
   - `POST /lessons/:id/plan`: three re-plans (`ANONYMOUS_REPLAN_LIMIT`, checked inside the row
     transaction), then 403 `sign_in_required`.
5. **The quota is per device, not per IP.** Each Turnstile-gated anonymous session gets one
   Workspace and so two lessons. IP cannot be the quota: a school puts its classrooms behind one NAT
   address, and the first teacher would use up the whole school's lessons. The IP is only a ceiling
   against bots. `anonymousSignInLimits` (`apps/api/src/auth/anonymous-limits.ts`) answers 429
   `rate_limited` once an address has made `ANONYMOUS_SIGNINS_PER_IP_DAILY` anonymous sign-ins that
   UTC day (default 20, `apps/api/src/env.ts`), counted in Postgres (`anonymous_signins`,
   `packages/db/src/schema/anonymous-signins.ts`). Only a sign-in that better-auth answered with 2xx
   counts, so tokenless posts that Turnstile refuses cannot lock a school out.
   - **Where the address comes from** (`apps/api/src/auth/client-ip.ts`). With `AUTH_IP_HEADER`
     unset, the ceiling takes the rightmost `x-forwarded-for` entry, the one the nearest proxy
     appended, so a client cannot pick its own bucket by sending the header. better-auth keeps its
     default: it trusts `x-forwarded-for` only when the header holds exactly one address, and
     otherwise puts the request in one shared rate-limit bucket per path. When a CDN goes in front
     of the api, `AUTH_IP_HEADER` names the header it sets (for example `cf-connecting-ip`); the
     ceiling and better-auth's limiter (`authIpAddress`) then both read it. A request with no
     address skips the ceiling, and the api logs that once.
   - **Pending.** On 2 Oct 2026 production runs with `AUTH_IP_HEADER` unset and
     `ANONYMOUS_SIGNINS_PER_IP_DAILY=1` (the api's boot line "anonymous lessons: client IP source
     for the per-IP ceiling" logs both). Both wait on the founder's decision once the Railway IP
     source is verified (TEACH-300; `infra/README.md`, "Known gaps"). This amendment decides
     neither.
6. **The daily cap is the kill switch.** `ANONYMOUS_LESSONS_DAILY_CAP` (default 200; 5 in production
   on 2 Oct 2026, from the same boot line) bounds the lessons anonymous users make per UTC day
   across every Workspace (`countAnonymousLessonsToday` in `anonymous-limits.ts`; a claimed
   Workspace drops out of the count). At the cap, `POST /auth/sign-in/anonymous` answers 403
   `anonymous_capacity` before better-auth runs (`app.ts` mounts `anonymousSignInLimits` before
   `auth.handler`), and so does an anonymous `POST /lessons` (`assertAnonymousMayCreate` in
   `routes/lessons.ts`). Both refuse when today's count is at or above the cap, so
   `ANONYMOUS_LESSONS_DAILY_CAP=0` stops every new anonymous session and every new anonymous lesson.
   It does not stop a re-plan or the generation of a lesson already made. There is no other switch.
   Both counts are soft: concurrent requests can pass the check together.
7. **Cleanup.** The worker's `auth.anonymous-cleanup` job
   (`apps/worker/src/jobs/anonymous-cleanup.ts`) runs daily at 03:17 UTC. It deletes anonymous users
   created more than `ANONYMOUS_USER_TTL_DAYS` ago (default 14, `apps/worker/src/env.ts`), up to 500
   a run. The cascade removes the Workspace they still own and its rows, and the job then deletes
   the stored objects under `<workspaceId>/`. A claimed Workspace has a new owner, so only the
   anonymous user goes; a claim that commits between the job's select and its delete keeps its
   objects. The job also drops `anonymous_signins` rows older than two days and expired `claim:`
   rows. A failed object delete is counted in the run's log line and not retried (TEACH-290).
8. **Turnstile.** better-auth's `captcha` plugin with Cloudflare Turnstile gates
   `POST /auth/sign-in/anonymous`, which mints an identity, and `POST /auth/sign-in/magic-link`,
   which sends mail to any address (`apps/api/src/auth/captcha.ts`). Google and Microsoft sign-in
   are not gated: the provider's consent screen is a human step. The web sends the token in
   `x-captcha-response`, which CORS allows (`app.ts`). The plugin answers before the endpoint runs:
   400 `MISSING_RESPONSE`, 403 `VERIFICATION_FAILED`, 500 when siteverify is unreachable. It does
   not check the token's hostname (`allowedHostnames` is unset). With `TURNSTILE_SECRET_KEY` unset
   there is no plugin and nothing is gated (local development, most tests). The api refuses to boot
   in production without it (`apps/api/src/env.ts`). A Railway PR environment always runs
   Cloudflare's always-pass test secret, to match the preview web build
   (`withPrEnvironmentDefaults`).
   - **Order on `POST /auth/sign-in/anonymous`.** The daily cap and the per-IP ceiling (`app.ts`),
     better-auth's rate limiter, Turnstile, then the endpoint. The api's CSRF guard covers the
     protected paths, not `/auth/*`, and better-auth checks `Origin` only on a request that carries
     a cookie. A cookieless sign-in from a foreign origin is therefore stopped by Turnstile, not by
     its origin. `scripts/smoke-prod.ts` pins the app-origin and foreign-origin anonymous cases and
     the magic-link case (400 each). The anonymous cases answer 403 or 429 instead on a day the cap,
     or the runner's IP ceiling, has been reached (TEACH-257).

## Amendment (2026-10-02, TEACH-300): one client address for both limiters, and magic-link send bounds

This replaces the "Where the address comes from" bullet of item 5 in the TEACH-249 amendment above.
The evidence is in `docs/security/auth-edge.md`.

1. **The address is `x-real-ip` on Railway.** Measured on a Railway PR environment: Railway's edge
   replaces a client's `x-forwarded-for` with two entries (the client, then a hop) and overwrites
   `x-real-ip` with the client address. The rightmost `x-forwarded-for` entry, which the per-IP
   ceiling used until now, is the hop. Railway therefore runs with `AUTH_IP_HEADER=x-real-ip`, and
   both limiters read it. No trusted-proxy list is configured, because no hop address is ever
   chosen. A CDN in front of the api changes `AUTH_IP_HEADER` to its client-IP header, and the
   probe is repeated first.
2. **One rule for both limiters.** `clientIp` (`apps/api/src/auth/client-ip.ts`) calls better-auth's
   own `getIPFromHeader` (`@better-auth/core/utils/ip`, pinned 1.7.2 like `better-auth`) on the
   header better-auth reads (`authIpAddress`). They resolve the same address from the same headers:
   a single valid address, with IPv6 grouped by /64 and IPv4-mapped IPv6 read as IPv4. With
   `AUTH_IP_HEADER` unset, `x-forwarded-for` counts only when it holds exactly one address.
3. **No address, one bucket.** A request whose address does not resolve is counted by the per-IP
   ceiling under `no-trusted-ip`, the key better-auth's limiter falls back to. It is bounded, not
   skipped. The api logs the first one per process, and better-auth's own one-time fallback warning
   reaches the log as an "authentication event" line with `rateLimitNoIp: true`. Every other
   library message is still dropped.
4. **Probe.** `POST /auth/sign-in/anonymous` with `x-tj-ip-probe: <own address>` logs, for each
   proxy header entry, booleans only: whether it equals the probe value, and which reserved range it
   is in. It stays on in production, because a forged probe learns nothing and the log line never
   carries an address.
5. **Magic-link send bounds.** `sendMagicLink` (`apps/api/src/auth/magic-link-bounds.ts`) allows at
   most `MAGIC_LINK_SENDS_PER_RECIPIENT_HOURLY` (default 5) sends to one address per rolling hour,
   and `MAGIC_LINK_SENDS_DAILY_CAP` (default 300) per UTC day in total. Each send is a row in
   `magic_link_sends` (migration `0011_magic_link_sends.sql`), keyed by an HMAC of the lower-cased
   address under `BETTER_AUTH_SECRET`. Over a bound, nothing is sent, no pending claim is written,
   the api logs counts only, and better-auth answers `{ status: true }` as for a send, so the
   response does not enumerate addresses. A send counts when it is admitted, before the provider
   call. The count is soft: concurrent requests can pass together. The worker's
   `auth.anonymous-cleanup` job drops rows older than two days.
6. **Production values** are the founder's: `AUTH_IP_HEADER`, `ANONYMOUS_SIGNINS_PER_IP_DAILY` and
   the two mail bounds are Railway variables. Live on 2 Oct 2026: `AUTH_IP_HEADER=x-real-ip` and
   `ANONYMOUS_SIGNINS_PER_IP_DAILY=20`; the mail bounds are unset, so the defaults (5 and 300)
   apply. The probes on both production hosts are in `docs/security/auth-edge.md`.
