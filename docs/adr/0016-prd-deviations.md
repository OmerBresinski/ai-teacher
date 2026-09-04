# 0016 — Deviations from the PRD accepted for MVP scaffolding

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-D5, F15 commitment #8, F18-D1, F18-R06, Master PRD §12 (offline), F17-R01 (sign-in methods)

## Context

The founder chose to defer two product commitments to move faster on the scaffold. Recording them here so they are not silently forgotten and so the PRDs can be amended or the decisions revisited before the affected milestone.

## Decision

1. **Data residency.** The PRD commits to UK storage by default (F15-D5; F15 §4 #8). The scaffold hosts compute and Postgres on Railway EU-West (Amsterdam) and files on Vercel Blob (Vercel-controlled regions). Data is therefore EU-resident, not UK-resident. **Revisit before M3 (paid launch, P1)** and no later than **M4 (UK K-12, P2)**, where F15-R01's public data-flow statement must be truthful. Options then: Railway UK region if available, or move Postgres to a London-region provider; move Blob to an S3-compatible store with a fixed region behind the existing `StorageAdapter`.
2. **PWA / offline.** F18-D1 and F18-R06 call for an installable PWA with offline Teach Mode and read-only Reviewed artefacts. The scaffold does not install a service worker or manifest. **Revisit at the F18 project**; Teach Mode itself is V1 (Master D10), so no MVP flow depends on offline.
3. **Parent domain and production cookie policy.** ADR 0008/0010 assume `app.<domain>` and `api.<domain>` under one registered parent so the session cookie can be `SameSite=Lax; Domain=.<parent>`. No domain is registered yet. Until it is, production and PR environments run on `*.vercel.app` + `*.up.railway.app` (cross-site) and the session cookie is `SameSite=None; Secure` with no `Domain` attribute, selected by `COOKIE_SAMESITE=none`. Known costs: one fewer CSRF layer (better-auth origin checks remain), and Safari/ITP or strict third-party-cookie settings may block sign-in on some school-managed devices. Also, transactional email (Resend) can only send from the shared `onboarding@resend.dev` sender to the account owner until a sending domain is verified. **Revisit in F17 (TEACH-30)**; must be resolved before any design partner is onboarded (M0/M1).
4. **Production email delivery.** P0 ships console-logged magic links only; deployed environments have no working sign-in for anyone but an operator reading logs. Owned by F17 (TEACH-29, Resend EU). Consequence for F15-R01: Resend becomes a sub-processor of teacher email addresses and must appear in the data-flow statement.

## Consequences

- Product PRDs in Notion should be annotated to reference this ADR (F15 §4 #8, F15-D5, F18-D1, F18-R06, F17-R01).
- Nothing in the scaffold blocks any reversal: storage is behind an adapter, hosting is Docker-based, the SPA can add a service worker without architectural change, and cookie mode is env-driven so TEACH-30 flips production to `Lax` without a code change (existing sessions are invalidated once).
