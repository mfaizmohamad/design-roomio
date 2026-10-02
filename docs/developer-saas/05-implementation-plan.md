# Implementation specification for the next agent

This file specifies work and acceptance criteria. **S01–S10 are specification
references, not bead IDs or task status.** Register/link this work in the existing
beads database when the tooling is available; see [HANDOFF.md](HANDOFF.md). The
research assignment alone did not authorize implementation; a later user request
authorized three independent implementation tracks. See the dated checkpoint in
the handoff before selecting the next packet.

Read `CLAUDE.md`, [the repository audit](02-repository-audit.md), and the relevant
specification below before changing code. Preserve existing uncommitted work.

## First executable milestone

Build a local Embercrest vertical slice that can **save the entire duplex, reopen
it, display one reviewed furniture GLB at measured scale, and present a clean buyer
view with working floor selection**. Use an owned or licensed test object. This
tests the highest-risk integration without requiring a generation subscription.
The real project's unresolved source approvals gate public release, not work on a
clearly identified private prototype or synthetic fixtures.

Next, secure the same path with organizations, private assets and immutable
publication. Then add saved buyer choices and reliable enquiries. AI generation
is an optional content-production improvement after asset ingestion works.

## Dependency order

```text
S01 source evidence ───────────────────────────► S06 approval/publication
S02 full-home persistence ─► S04 assets ─► S05 viewer ─► S07 buyer enquiry
S03 organization security ─► S04 production assets ─► S06 ─► S07
S04 assets ─► S08 photo evaluation/jobs (optional for first paid pilot)
S01–S07 + S09 launch hardening ─► S10 measured paid pilot
```

Some local viewer/asset work can use fixtures before S03, but its production routes
cannot ship without tenant authorization. S09 checks are built into each relevant
packet and assembled into the final release gate; they are not a last-week security
pass. Do not hold the sales pilot for S08 if manual/import assets satisfy it.

## S01 — Establish Embercrest's approved source package

Suggested bead: task, P0. Reuse/link existing `roomio-pnc.1` for release-data cleanup
after inspecting its actual status.

Inputs: original plans/CAD/PDF, project jurisdiction/registration, area statement,
brand assets, inclusion schedule, photography/model rights and the architect's
review. Start at `docs/embercrest-plan-review.md`, `src/data/homes/embercrest.ts`
and its tests. Record source revision/page, unit type versus actual unit, explicit
assumptions and reviewer for each claim. Do not search by project name and adopt
an unrelated developer's details.

Acceptance: approved area labels; resolved or clearly bounded walls/elevations,
stairs/voids/openings; public demo status until approvals exist; evidence of rights;
release artifact excludes scraped personal content. A source reviewer can identify
which revision produced the displayed home. S01 can also document missing evidence
without pretending it has been approved.

## S02 — Wire durable whole-home persistence

Suggested bead: feature, P0. Entry points: `src/wizard/Wizard.tsx`,
`src/three/houseSession.ts`, `src/repository.ts`, `src/persistence.ts`, existing
`persistence/src/envelope/` and `server/app.js`. Use shared schema/migration work;
new common logic belongs under `shared/lib/`, not a new island.

Snapshot active edits and all rooms/positions/levels atomically. Preserve lighting,
bookmarks, floor elevations, room types and future asset references. Add server-side
nested validation, limits and stale-revision handling. Reconcile legacy `isReplica`
round-tripping without using it as a publication-validation exemption.

Acceptance: edit lower and upper furniture, save, hard reload and compare the whole
home; import a legacy room; reject corrupt/nonnumeric/oversized nested content;
surface local quota/cloud failure; reject stale concurrent saves; preserve unsaved
work on failure. The UI cannot announce a saved duplex after saving just one room.

## S03 — Add organizations and authorization

Suggested bead: feature, P0. Entry points: `server/migrations/`, auth/middleware,
route ownership queries and server tests. Add organization/membership/project/unit
type/unit entities and scoped relationships. Preserve existing session, origin,
parameterization and resource controls. Keep the migration role separate from the
runtime role. Split route/service modules when useful without rewriting the backend.

Acceptance: two-tenant tests try the other tenant's home, asset, job, release draft,
lead and export identifiers; every access fails without leaking private records.
Role tests prevent sales/editors from publishing where unauthorized. Test member
revocation and database-connection reuse. Existing user designs remain accessible
through an explicit migration/ownership policy.

## S04 — Add versioned furniture assets and one measured GLB

Suggested bead: feature, P0. Depends on S02; production storage/routes depend on S03.
Entry points: `src/types.ts`, `src/three/Furniture3D.tsx`, `FurnitureEditor.tsx`,
`mount.ts`, collision logic and new modules under `src/assets/`/`server/`.
Follow [the furniture contract](03-furniture-from-photos.md).

Deliver a reviewed import path before a generation provider. Normalize units,
orientation/pivot, materials and collider from one approved asset version. Keep
procedural fallback; respect immutable product dimensions. Uploads go through
private quarantine and isolated validation with explicit ceilings.

Acceptance: an asymmetric known-size object verifies orientation and scaling;
placement works on both storeys; instance material changes do not affect another
item; save/reload pins the version; missing/retired/unloadable assets show a labeled
fallback; unsupported external resources and oversized models are rejected. Verify
actual rendered shadows/materials and resource cleanup in the running app.

## S05 — Create the developer's buyer-facing experience

Suggested bead: feature, P1. Depends on S02/S04 for full acceptance. Add a lazy viewer
route/shell under `src/viewer/` reusing `RoomView`, `HouseView`, camera and floor
logic. Avoid coupling this route to editor-only controls or the listings workflow.
The immutable release manifest becomes its production input in S06.

Acceptance: phone and desktop users can reach both floors, floor plan, room view,
furnished/unfurnished state and reset; permitted furniture changes are clear; the
building is fixed; included/optional/illustrative content is distinguishable.
Keyboard/touch navigation, loading/error states and 2D/still fallback work. Reviewed
screenshots cover lower/upper/whole-home and a real-device recording covers touch.

## S06 — Approve and publish immutable releases

Suggested bead: feature, P0. Depends on S01–S04; integrate viewer consumption with
S05. Add approval/release services and an allowlisted public manifest. Approval is
bound to the exact home, metadata and asset versions, and publication is atomic.

Acceptance: changed drafts cannot reuse approval; unauthorized publishers fail;
unapproved/cross-tenant assets cannot enter a release; raw source files and staff
notes never reach the public payload. An older link stays reproducible after an
edit; retirement and cache/link behavior are tested. Release history records who
approved and published, with restoration of a prior release demonstrated.

## S07 — Save buyer choices and deliver enquiries reliably

Suggested bead: feature, P0. Depends on S05/S06 and organization-scoped backend.
Store only allowed configuration changes against a release. Anonymous capability
links contain no personal details. Add contact-purpose notice, optional marketing
choice, minimum contact fields, abuse limits and an outbox-backed lead queue.

Acceptance: a shared configuration restores both floors and correct furniture;
tampered geometry/options are rejected; duplicate submits produce one logical
lead; a CRM outage leaves a visible undelivered record and replay succeeds without
duplication. Sales sees the chosen layout/context; public viewers cannot read leads.
Test withdrawal/deletion and expired/retired configuration behavior.

## S08 — Evaluate photo generation, then integrate only a winner

Suggested bead: spike followed by feature (use types supported by installed `bd`),
P1. Depends on S04. Evaluate the bounded owned-image corpus and cost-per-approved-
asset rubric in [the furniture plan](03-furniture-from-photos.md). Resolve input/
output rights, API terms, confidentiality and an approved spend ceiling first.

Acceptance for the spike: reproducible settings, review scores, all attempted costs,
rejections and operator minutes, with an explicit adopt/defer decision. Acceptance
for integration: durable jobs, budget reservation, refresh/retry/callback idempotency,
provider outage recovery and stored outputs; a real photo yields a reviewed asset
placed and restored inside Embercrest. Use synthetic provider responses in offline
tests. A failed evaluation leaves manual/import production working.

## S09 — Make the public pilot operable

Suggested bead: epic/task group, P0; reuse existing launch beads where applicable.
Consult `docs/LAUNCH_PLAN.md` for `roomio-pnc.2` (detection deployment), `.4`
(deployment), `.6` (privacy), `.7` (monitoring), `.9` (phones), `.10` (backups),
`.11/.12` (load/cost). These historical references were not checked in a live tracker.

Deliver a clean release artifact, production configuration, quotas, private sources,
target-device/connection measurements, fallback behavior, job/lead/spend alerts,
backup restore and rollback evidence. Disable or secure the prototype public
detection path until its worker/storage/ownership contract is production-ready.

Acceptance: the gates in [architecture and launch](04-architecture-and-launch.md)
are demonstrated, including cross-tenant security and resource-limit boundaries.
An operator can recover from a bad release, stuck provider, database restore and
undelivered lead. There are no unapproved real listing records/photos in public output.

## S10 — Run a bounded paid pilot and decide whether to expand

Suggested bead: task, P1. Depends on S01–S07 and S09; S08 is optional. Agree scope,
price, revision allowance, contact handling, entitlements and success measures with
the actual budget owner. Implement the event dictionary and lead-status attribution
from [the pilot brief](01-product-and-pilot.md), without contact data in analytics.

Acceptance: documented buyer tests, real funnel denominators, asset/onboarding/
support labor, total recurring cost and an actual renewal/second-layout decision.
Automated subscription billing and more integrations follow demonstrated demand.
If the product is still labor-heavy, revise service pricing/scope before expansion.

## Delivery scale and stop conditions

A planning range is 6–10 weeks to a measured pilot with two product engineers,
part-time 3D/content support and responsive developer reviewers. This is an estimate,
not a commitment; source quality, existing-change integration and mobile rendering
can dominate it. An agent turn is not a reliable calendar unit.

Use staged exits: local vertical slice → tenant-safe reviewed release → complete
buyer/lead journey → observed pilot. Stop expansion when there is no accountable
buyer, no publishable source evidence, unacceptable per-layout labor, or no credible
mobile experience. These are reasons to revise the product or content process,
not reasons to conceal limitations with marketing language.

## Verification contract for implementation

Run the full `CLAUDE.md` green bar and applicable visual harness. Preserve the root
tests' offline contract; provider calls are stubbed and actual paid evaluation is
separate. Server security tests need local Postgres and real isolated test data.

Each packet must leave its bead, changed files, migration impact, tests/run verdict,
screenshots where relevant, current source/provider assumptions and next dependency
in the handoff. Do not broaden into unrelated existing edits or weaken checks.
Research completion does not mean implementation, source approval, or launch is done.
