# Auth edge: where the client address comes from (TEACH-300)

Redacted evidence for the client address that both sign-in limiters key on: the api's per-IP
anonymous ceiling (`clientIp` in `apps/api/src/auth/client-ip.ts`) and better-auth's rate limiter
(`advanced.ipAddress` in `apps/api/src/auth/auth.ts`). No address appears here, only positions and
booleans. The decision is the ADR 0008 amendment of 2026-10-02 (TEACH-300).

## How it was measured

`POST /auth/sign-in/anonymous` logs one line, "anonymous sign-in: IP probe (booleans only)", when
the request carries `x-tj-ip-probe: <the caller's own address>` (`ipProbeReport` in `client-ip.ts`,
called from `anonymousSignInLimits`). For each `x-forwarded-for` entry, in order, it logs whether
the entry equals the probe value and whether it is in 100.64.0.0/10, 100.0.0.0/8, a private range
or TEST-NET-3 (203.0.113.0/24). It also logs whether `x-real-ip` equals the probe value. A forged
probe header can only produce booleans, so it needs no secret.

Three requests, at least 10 s apart, each without a Turnstile token (they answer 400 and create
nothing), each with `x-tj-ip-probe` set to the address `https://api.ipify.org` reports:

- (a) plain;
- (b) with a forged `X-Forwarded-For: 203.0.113.7`;
- (c) with a forged `X-Real-IP: 203.0.113.8`.

The log is read with `railway logs --filter "IP probe" --json` from a scratch directory linked to
the environment's `api` service.

## Results

### PR environment `ai-teacher-pr-387` (`*.up.railway.app`), 2 Oct 2026, IPv4 client

| Probe | `x-forwarded-for` entries | Entry 1 | Entry 2 | Forged value survives | `x-real-ip` = client |
| ----- | ------------------------- | ------- | ------- | --------------------- | -------------------- |
| (a) plain | 2 | client | public hop | n/a | yes |
| (b) forged `X-Forwarded-For` | 2 | client | public hop | no (TEST-NET-3 nowhere) | yes |
| (c) forged `X-Real-IP` | 2 | client | public hop | no (overwritten) | yes |

"Public hop" means the entry was not the client and was in none of 100.0.0.0/8 (so not
100.64.0.0/10 either), the private ranges or TEST-NET-3. Its range was not identified, and no
setting depends on it.

### Production

Read-only, 2 Oct 2026: `api.dayback.app` is a CNAME to a `*.up.railway.app` name, and both it and
`api-production-903f.up.railway.app` answer with `server: railway-hikari` and `x-railway-edge`.
Neither response carries a CDN cache header (`x-cache`, `cf-cache-status`, `via`, `age`).

Probes after the merge of PR #387 (2 Oct 2026, IPv4 client, `AUTH_IP_HEADER=x-real-ip` live),
three per host, 12 s apart, after `smoke:prod --target dayback` had finished:

| Host | Probe | `x-forwarded-for` entries | Entry 1 | Entry 2 | Forged value survives | `x-real-ip` = client | Address resolved |
| ---- | ----- | ------------------------- | ------- | ------- | --------------------- | -------------------- | ---------------- |
| `api.dayback.app` | (a) plain | 2 | client | public hop | n/a | yes | yes |
| `api.dayback.app` | (b) forged `X-Forwarded-For` | 2 | client | public hop | no | yes | yes |
| `api.dayback.app` | (c) forged `X-Real-IP` | 2 | client | public hop | no | yes | yes |
| `api-production-903f.up.railway.app` | (a) plain | 2 | client | public hop | n/a | yes | yes |
| `api-production-903f.up.railway.app` | (b) forged `X-Forwarded-For` | 2 | client | public hop | no | yes | yes |
| `api-production-903f.up.railway.app` | (c) forged `X-Real-IP` | 2 | client | public hop | no | yes | yes |

The custom domain and the Railway domain behave the same, and no request carried
`cf-connecting-ip`. The api's boot line after the deploy read `ipHeader: x-real-ip`,
`configured: true`, `perIpDaily: 20`.

## What it means

- Railway's edge **replaces** a client's `x-forwarded-for`: it sends exactly two entries, the client
  first and one hop after it. A forged value does not survive anywhere in the chain.
- Railway's edge **overwrites** `x-real-ip` with the client address, so a forged `X-Real-IP` is
  ignored. `x-real-ip` is the one header whose single value is the client.
- The rightmost `x-forwarded-for` entry, which the ceiling used before TEACH-300, is the hop, not
  the client. better-auth trusts `x-forwarded-for` only when it holds exactly one address, so with
  two entries it resolved nothing and put every request in one shared bucket per path.
- Railway staff answers on Central Station disagree with each other about this. These measurements,
  on a PR environment and on both production hosts, are what the settings follow.

## Settings

- `AUTH_IP_HEADER=x-real-ip` on Railway (production and any environment behind Railway's edge).
  Both limiters then read `x-real-ip`. No trusted-proxy list is needed. When a CDN goes in front
  of the api, `AUTH_IP_HEADER` becomes the CDN's client-IP header (for example
  `cf-connecting-ip`), and these probes are repeated.
- Unset, both limiters read `x-forwarded-for` and trust it only with exactly one address, so on
  Railway every request resolves to no address and shares one bucket per path. That is bounded, but
  every visitor then shares it.

## Grouping and fallback

- **One rule.** `clientIp` calls better-auth's own `getIPFromHeader` on the header better-auth
  reads, so the two limiters resolve the same address from the same headers
  (`apps/api/src/auth/rate-limit.test.ts`).
- **IPv6** is grouped by /64 (`normalizeIP`), and an IPv4-mapped IPv6 address counts as its IPv4
  address. One client cannot rotate addresses inside its /64 past either limiter.
- **No resolvable address** (header missing, invalid, or more than one value): better-auth keys the
  request on `no-trusted-ip|<path>`, and the per-IP ceiling counts it under the same
  `no-trusted-ip` key. Both stay bounded. The api logs the first such request per process
  ("anonymous sign-in: no client IP resolved; counted in the shared bucket"), and better-auth's own
  one-time warning reaches the log as an "authentication event" line with `rateLimitNoIp: true`.

## Magic-link mail bounds

Turnstile and the per-IP limits bound automated requests, not sends to one address by a person or a
captcha solver. `sendMagicLink` (`auth.ts`, `apps/api/src/auth/magic-link-bounds.ts`) also allows
at most `MAGIC_LINK_SENDS_PER_RECIPIENT_HOURLY` (default 5) sends to one address per rolling hour,
and `MAGIC_LINK_SENDS_DAILY_CAP` (default 300) per UTC day across every address. Over a bound the
send is skipped, the api logs "magic link not sent: send bound reached" with counts only, and
better-auth answers `{ status: true }` as for a send. The table `magic_link_sends` holds an HMAC of
the lower-cased address, never the address.

A bounded request answers sooner than one that waits for the mail provider. Timing can show that
someone asked for several links to that address within the hour. It does not show whether the
address has an account.
