# 0008 — better-auth for identity

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F17-R01 (magic link, Google/Microsoft; passkeys V1), F15-D3 (teacher identity is the only personal data), F17-R12 (account deletion)

## Context

Teacher identity (email, name) is the only personal data the product holds by design. Hosted identity providers would move that data to a third party and add cost; F17 needs magic links, Google and Microsoft OAuth now and passkeys in V1.

## Decision

`better-auth` runs inside `apps/api` with the Drizzle adapter; its tables live in `packages/db`. The scaffold enables email magic link only, with Google and Microsoft OAuth wired but gated behind environment variables (credentials arrive with the F17 project). Sessions are cookie-based. A `requireSession` Hono middleware resolves the user and their personal workspace and attaches both to the request context.

## Consequences

- Identity data stays in our database, in the same region as everything else.
- The web app is on a different origin from the API (ADR 0010); cookies must be `Secure; SameSite=None` or both apps must share a parent domain. The scaffold uses a shared parent domain (`app.<domain>` and `api.<domain>`) and sets the cookie domain accordingly; local development uses a Vite dev proxy so both appear same-origin.
- Passkeys are a plugin addition in V1 with no architectural change.
