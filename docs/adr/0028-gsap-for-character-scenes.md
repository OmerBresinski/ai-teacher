# 0028 — GSAP for the character scenes, click-loaded

- Status: Accepted
- Date: 2026-09-14
- Related PRD decisions: none recorded; product decision is Greg's, 14 Sept 2026 (see Context)

## Context

Greg, 14 Sept 2026: the four characters passing the lesson sheet to each other — the marketing
site's hand-off animation — should become the beat structure of the conversational intake (one
character per turn, the pass as the transition) and of the generating view, driven by real stage
events. This ticket (TEACH-310) only adds the dependency and the load/reduced-motion rules; porting
the scene itself is separate work.

The marketing site already has this choreography: `homepage/production/production.js` and
`homepage/motion/cast.js` build it as GSAP timelines, against GSAP 3.14.2 vendored directly at
`homepage/motion/vendor/gsap.min.js` (no package manager, no bundler for the homepage). `apps/web`,
`packages/ui` and `packages/editor` have no animation dependency today — confirmed by reading all
three `package.json` files on 14 Sept 2026: no `gsap`, `motion`, `framer-motion` or `react-spring`.

GSAP moved to a "no charge" standard license in 2025, covering commercial use and plugins that used
to require Business Green; see the Licence section below. Reusing GSAP means the port can carry
over Omer's existing timelines and their timing instead of re-authoring the choreography in a
different animation model.

`packages/editor` already has a proven click-loaded pattern for a library that must not sit in a
route chunk: `packages/editor/src/export/index.ts` deliberately does not re-export `./pptx`,
`./png` or `./docx` — pptxgenjs, modern-screenshot and docx are reached only through
`await import()` inside the export action (ADR 0023 §4), and `scripts/check-bundle-budget.ts`
(TEACH-113) asserts none of the three ever appears in a chunk reached by a static import.

## Decision

1. **`gsap` is a dependency of `apps/web` only**, pinned exact at `3.14.2` like the app's other
   dependencies (`apps/web/package.json`) — the version already vendored for the homepage, so the
   ported timings need no unit conversion. It is not added to `packages/ui` or `packages/editor`:
   only `apps/web` routes will host the character scenes, and the editor must never carry it (see
   the load rule).
2. **One loader, `apps/web/src/lib/gsap.ts`.** `loadGsap(): Promise<typeof import("gsap").gsap>`
   wraps a dynamic `import("gsap")`, memoising the resolved promise so every caller after the first
   gets the same GSAP instance without re-importing or re-configuring. The first resolution also
   calls `gsap.config({ nullTargetWarn: false })` exactly once — a scene whose target element has
   already left the DOM (a fast turn transition, an aborted generation) should not warn to the
   console. A failed load (a dropped chunk request) clears the memoised promise and rethrows, so
   the next call retries instead of replaying the same rejection for the rest of the page's life.
   `gsap.ts` is the *only* file under `apps/web/src` allowed to `import ... from "gsap"` statically
   — including a plugin subpath such as `"gsap/Flip"`, since a future plugin loads through this
   same click-loaded mechanism (Consequences, below), not a separate static dependency; `gsap.test.ts`
   greps the tree for both forms to enforce that, mirroring how `export/index.ts` documents its own
   dynamic-import-only boundary.
3. **`prefersReducedMotion()` sits beside it**, wrapping
   `matchMedia("(prefers-reduced-motion: reduce)").matches`. See the reduced-motion rule below.
4. **The chunk-budget check is extended, not duplicated.** `gsap` is added to
   `scripts/check-bundle-budget.ts`'s `CLICK_LOADED_CHUNKS` (the pptxgenjs/modern-screenshot/docx
   list, TEACH-113) as a fourth guarded pattern. `findClickLoadedLeaks` already fails the build if
   any guarded chunk is reached through a static `imports` edge from anywhere in the manifest —
   stronger than "just the entry and editor chunks" required by this ticket, and it is the existing
   mechanism rather than a second parallel one.
5. **No React wrapper.** `@gsap/react` is not added in this ticket; scenes call `loadGsap()`
   directly from the effect or interaction that starts them.

### Load rule

`gsap` reaches the browser only through `loadGsap()`'s dynamic import, called from the
click/interaction/mount that actually starts a character scene — never imported at module scope,
never imported by anything in `packages/editor` or by a route that does not have a scene. This
keeps `gsap` out of the app's initial chunk and out of every editor chunk (`lesson-editor`,
`worksheet-editor`, and the other budgeted routes in `BUNDLE_CHUNK_BUDGETS`), the same rule ADR
0023 §4 applies to the exporters, for the same reason: a library only some routes need must not tax
every route's TTI.

### Reduced-motion rule

Every scene built on `loadGsap()` must call `prefersReducedMotion()` before building its timeline
and, when it is `true`, skip the GSAP choreography entirely in favour of a plain CSS crossfade
between the beats it would otherwise animate. This is a hard rule for any future scene, not a
per-scene judgment call: `prefers-reduced-motion: reduce` means no motion, not "less" motion.

### Licence note

GSAP's package (`apps/web/node_modules/gsap/package.json`, `"license"` field) and the vendored
homepage copy both point to the same terms:

```
/*!
 * GSAP 3.14.2
 * https://gsap.com
 *
 * @license Copyright 2025, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license.
 * @author: Jack Doyle, jack@greensock.com
 */
```

— the GSAP Standard "no charge" license (in effect since 2025), which covers commercial use
including the plugins that previously required a paid Business Green membership (bonus/premium
plugins, `MorphSVG`, `SplitText`, etc.). No paid license or attribution notice is required to ship
GSAP in `apps/web`; nothing here changes if a later ticket adds a specific plugin.

## Alternatives

- **Motion (`motion` / `framer-motion`).** A capable, actively maintained web animation library
  with a friendlier React API than raw GSAP. Rejected for this port specifically: Omer's existing
  choreography (`homepage/motion/cast.js`, `production.js`) is already GSAP timelines — labels,
  nested timelines, stagger — and re-expressing that in Motion's model risks subtly changing the
  timing everyone has already approved on the homepage. Motion remains a reasonable default for
  *new* animation work that has no GSAP original to match.
- **Web Animations API.** Native, zero dependency, but timeline composition (nested timelines,
  labels, relative position insertion, stagger helpers) has to be hand-rolled; porting a
  multi-actor hand-off sequence on raw WAAPI would mean rebuilding most of what GSAP's timeline
  already gives Omer's choreography for free. Rejected for the port; still fine for a single-element
  fade elsewhere.
- **CSS only (keyframes/transitions).** Sufficient for the crossfade the reduced-motion rule falls
  back to, and used for exactly that. Not sufficient for the actual scene: four characters handing
  off a sheet needs coordinated, sequenced, JS-driven timing (waiting on real stage events) that CSS
  keyframes cannot express without a re-render per step.

## Consequences

- `apps/web/package.json` gains one runtime dependency (`gsap@3.14.2`); `packages/ui` and
  `packages/editor` gain none.
- `scripts/check-bundle-budget.ts`'s click-loaded guard now covers four libraries instead of three;
  its existing tests (`check-bundle-budget.test.ts`) are extended with a gsap fixture rather than a
  new test file.
- The character scenes themselves (intake beats, generating view) are not built by this ticket —
  `loadGsap()` and `prefersReducedMotion()` exist with nothing calling them yet. The first caller is
  responsible for actually following the reduced-motion rule; this ADR is where that obligation is
  recorded so a later review can point to it.
- Revisit if a scene needs a GSAP plugin (`MorphSVG`, `SplitText`, `Flip`): those load through the
  same `loadGsap()`-style dynamic import, registered with `gsap.registerPlugin()` after the core
  module resolves, not as a second static dependency.
