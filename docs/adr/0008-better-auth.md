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
