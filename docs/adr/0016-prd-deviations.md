# 0016 — Deviations from the PRD accepted for MVP scaffolding

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-D5, F15 commitment #8, F18-D1, F18-R06, Master PRD §12 (offline)

## Context

The founder chose to defer two product commitments to move faster on the scaffold. Recording them here so they are not silently forgotten and so the PRDs can be amended or the decisions revisited before the affected milestone.

## Decision

1. **Data residency.** The PRD commits to UK storage by default (F15-D5; F15 §4 #8). The scaffold hosts compute and Postgres on Railway EU-West (Amsterdam) and files on Vercel Blob (Vercel-controlled regions). Data is therefore EU-resident, not UK-resident. **Revisit before M3 (paid launch, P1)** and no later than **M4 (UK K-12, P2)**, where F15-R01's public data-flow statement must be truthful. Options then: Railway UK region if available, or move Postgres to a London-region provider; move Blob to an S3-compatible store with a fixed region behind the existing `StorageAdapter`.
2. **PWA / offline.** F18-D1 and F18-R06 call for an installable PWA with offline Teach Mode and read-only Reviewed artefacts. The scaffold does not install a service worker or manifest. **Revisit at the F18 project**; Teach Mode itself is V1 (Master D10), so no MVP flow depends on offline.

## Consequences

- Product PRDs in Notion should be annotated to reference this ADR (F15 §4 #8, F15-D5, F18-D1, F18-R06).
- Nothing in the scaffold blocks either reversal: storage is behind an adapter, hosting is Docker-based, and the SPA can add a service worker without architectural change.
