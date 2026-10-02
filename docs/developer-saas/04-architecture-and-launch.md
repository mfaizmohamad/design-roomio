# Proposed SaaS architecture and launch requirements

This is a design specification, not implemented behavior. Keep the current React,
R3F/Three, Express and Postgres stack. Add a modular application API, one durable
background worker and object storage/CDN. A renderer rewrite, Kubernetes and a
collection of new microservices are not prerequisites for the pilot.

## System boundaries

```text
Staff editor ──authenticated API──► projects, drafts, assets, reviews
                                         │
                               Postgres + job/outbox tables
                                         │
                          worker ────────► optional 3D provider
                            │
                     private source storage
                            │ review + approved publication
                            ▼
Buyer viewer ◄──release API + approved asset delivery
      │
      └──configuration / consented enquiry──► lead queue ──► owned CRM
```

Keep editor/API on one origin initially to preserve the existing session and
origin controls. Public viewing can be embedded without giving an iframe an
authoring session. Use an explicit embedding policy and narrow message protocol;
validate message origins and schemas. A custom domain is a later operational
feature with domain ownership, TLS and cache-isolation requirements.

Use managed Postgres with backups, one deployable API, a separate worker process,
private source storage and approved asset delivery. Evaluate an India region for
latency and customer requirements; this research does not assert a universal
India-only data-residency obligation or select a paid cloud plan. Measure real
network performance before contracting a public availability promise.

## Domain model

| Entity | Required distinction |
| --- | --- |
| Organization / membership | Developer account and staff permissions; a user may belong to several organizations |
| Project / building | Commercial development and optional tower/block; project branding and approved sales metadata |
| Unit type / unit | Reusable layout versus a particular sellable unit, floor, orientation and availability |
| Home draft / revision | Complete editable dwelling with rooms, levels, openings, finishes, furniture and bookmarks |
| Source revision / approval | Evidence and reviewer for geometry, area statements, inclusions and publication content |
| Asset / asset version | Product identity versus immutable geometry/material derivative; explicit licensed scope |
| Published release | Frozen, approved public manifest referencing exact home and asset revisions |
| Buyer configuration | Permitted choices against one published release; never edits the developer's base layout |
| Lead / consent / delivery attempt | Contact request, purpose/version of notice, and reliable sales-team delivery |
| Job / usage ledger / entitlement | Async work, cost reservation and the organization's contracted limits |

Tenant-owned records carry `organization_id`. Where records refer across tables,
use scoped foreign keys or equivalent constraints so a project cannot reference
another organization's private asset. An intentionally shared catalog has separate
grants; do not treat a missing tenant ID as public access.

Start with owner/admin, editor, publisher/reviewer and sales roles. Authorize each
operation on the server; a hidden UI control is not access control. Sales can view
leads and public configurations but cannot change approved geometry. A buyer uses
public release capabilities, not a staff membership. Privileged support access
must be explicit and audited.

Extend parameterized ownership checks to organization membership on every read,
write, export, job status, asset URL and webhook action. Add Postgres row security
as defense in depth where the team can test it properly: transaction-local tenant
context, a runtime role without bypass privileges, and pool-reuse tests. Owners
and bypass roles require special care; RLS is not automatic protection merely
because it is enabled. [Postgres documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

## Complete-home persistence before sharing

Adapt the existing envelope in `persistence/src/envelope/` to the actual
`useHouse`/room-editor integration. Preserve legacy single-room imports through
migrations. Serialize the active room's current edits plus every other room,
positions, level elevations, materials, lighting and bookmarks in one transaction.
Keep the schema version explicit; refuse unsupported writes instead of dropping
data. Private legacy round-trip preservation and a safe public projection are
different contracts.

Use a monotonic revision with conditional updates. A stale staff save receives
409 and a recovery path; it must not overwrite a coworker's newer revision. A
successful save indicator requires acknowledged durable persistence. Guest/local
saves show their actual storage mode and report quota failure honestly.

Publishing validates the whole snapshot and its dependencies, records an approval
bound to the exact revision/hash, then atomically creates a release. Any content
change invalidates that approval. Validation includes sources, intended area labels,
rights, allowed asset versions, valid bounds and the reference scene checks.
Store only an allowlisted buyer manifest: no raw source photos, staff notes, contact
lists, provider credentials or internal source document links.

Publication lifecycle: `draft → in_review → approved → published → retired`.
An approved edit creates a new revision/release. Keep old configurations pinned;
offer an explicit migration rather than silently switching their model. A project
alias may point to the latest release, while a saved buyer link retains its original
release ID. Retirement must have a useful replacement/unavailable screen.

Keep changing unit availability and prices separate from immutable geometry.
Display their source and update time; stale or unavailable inventory becomes
“confirm with sales,” not an invented available unit. Prices need approved scope,
validity and exclusions. Mirrored layouts, orientation, windows and unit-specific
views require reviewed variants; duplicating a unit type is not approval of them.

Public immutable geometry can be cached; private previews require authenticated
or signed delivery. Short-lived links, access checks and cache purge support
revocation, but cannot recall files a visitor has already downloaded. Never promise
that a public browser model is impossible to extract. Obtain the necessary model
distribution rights before publishing it.

## Suggested API surface

Exact route names are proposed; maintain existing legacy endpoints during migration.

| Operation | Boundary contract |
| --- | --- |
| `PUT /api/orgs/:org/projects/:project/homes/:home` | Membership, nested bounded schema, revision precondition, durable whole-home save |
| `POST .../assets/uploads` and `POST .../assets/:id/finalize` | Authorized upload reservation, byte/type limits, completion/checksum verification; private until reviewed |
| `POST .../asset-jobs` / `GET .../asset-jobs/:id` | Idempotency key, allowed asset ownership, budget reservation, persisted status |
| `POST .../homes/:home/reviews` | Reviewer capability, immutable draft hash and approval evidence |
| `POST .../homes/:home/releases` | Publisher capability, matching approval, complete manifest validation |
| `GET /api/public/releases/:id` | Published-only projection, retirement handling, no editor/tenant secrets |
| `POST /api/public/releases/:id/configurations` | Only allowed choices and bounded transforms; opaque share capability, no contact data in link |
| `POST /api/public/releases/:id/leads` | Explicit contact purpose, validated fields, abuse limits, idempotency and configuration/release validation |

Every new write includes a ceiling in the same change, as required by `CLAUDE.md`.
Proposed starting limits: 2 MB home JSON, 50 rooms/10 levels/500 furniture items
per home, 10 MB per input image with a decoded-pixel limit, 4 provider-bound views,
50 MB uploaded source GLB, two active generation jobs per organization and a hard
daily spend cap configured by entitlement. Check these limits against the pilot;
they are application policy, not provider guarantees. Rate-limit public configuration
and lead creation, cap retained records, and expire abandoned anonymous drafts.

## Jobs, uploads and cost control

Use a Postgres-backed queue with leases and bounded retries at pilot volume; keep
it separate from the HTTP request lifecycle. A job progresses through
`queued → submitted → processing → validating → needs_review → ready`, with
`failed/cancelled` terminal states and recorded reasons. `ready` does not mean
automatically published.

Reserve estimated spend atomically before submission. Record provider task IDs,
model/settings, cost and attempts. A timeout after submission is ambiguous: reconcile
the existing task before creating another charge. A local cancellation may not stop
provider billing. Retry transient failures with backoff; send permanent failures to
an operator queue. Replays and duplicate callbacks must not duplicate assets or costs.

Copy completed results into owned storage promptly and verify them; do not persist
temporary provider download URLs as the asset. Keep provider credentials in the
worker, allow only known download hosts/redirects, block local-network targets, and
cap downloads. Verify webhook authenticity according to the chosen provider contract.

Process untrusted models/images in an isolated worker with CPU, memory, disk,
decoded-texture, node/mesh-count and time limits. Reject unsupported external
resources and unsafe archive paths; validate content rather than trusting extension
or client MIME. Raw uploads stay private. This applies to manufacturer files too.
[OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## Lead delivery and commercial operations

Write the lead and an outbox event in the same transaction. The worker retries
CRM delivery with an idempotency key and stores acknowledgement/error status.
The developer dashboard exposes undelivered leads and permits controlled replay.
Browser success means the enquiry was stored, not that a salesperson has booked
a visit. Do not expose leads through public configuration links or analytics.

Start with a manually invoiced, contracted pilot plus server-enforced entitlements.
Paid software subscriptions can follow validated renewal demand. When automated,
verify billing webhooks, reconcile duplicate/out-of-order events, define grace and
cancellation behavior, and do not delete customer content merely because a payment
failed. No home reservation or furniture sale payment is part of this scope.

## India-specific publication and privacy

RERA's carpet-area definition excludes balconies/external walls and includes
internal partitions; section 11(2) addresses prominent registration/authority
information, and section 12 addresses incorrect advertising/model representations.
Treat a sales viewer as reviewed marketing content. Confirm the project's actual
registration, jurisdiction, applicability and approved area statement before launch;
do not infer them from “Embercrest.” [RERA Act](https://www.indiacode.nic.in/indiacode/bitstream/123456789/2158/1/A201616.pdf)

For a Maharashtra project, check current MahaRERA advertisement/QR directions and
their application to the viewer and exported collateral. An enforcement order
references the April 2025 visibility and positioning requirements; it is evidence
for review, not proof that this project is in Maharashtra. [MahaRERA order](https://maharera.maharashtra.gov.in/sites/default/files/final_order_document/PUNE_ORD_80OF2025_0.pdf)

DPDP rules were notified in November 2025 with staged commencement; as of this
research date, do not describe every rule as already effective. Review the official
Act commencement material, final rules and corrigendum for the actual launch date.
[MeitY index](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025%3B),
[Gazette commencement clauses](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)

Product requirements: clear contact-purpose notice, separate optional marketing
choice, withdrawal/deletion workflow, documented developer/Roomio processing roles,
subprocessor terms, retention and incident ownership. Define retention by data
class with counsel/customer requirements; do not set a blanket deletion period that
conflicts with applicable recordkeeping. Keep security records and raw furniture
photos in separate policies. Test deletion across active storage, derived assets,
provider copies and backup-expiry policy. Browsing should not require a phone number.

The repository already contains scraped personal listings and mirrored images.
Reuse `roomio-pnc.1` after checking its status. A hidden listings route does not
remove files copied from `public/` into a deployment. Produce and inspect a clean
release artifact with only authorized/synthetic content. This is a launch gate,
not permission to alter the user's existing private dataset during research.

## Performance and operational acceptance

Use the existing lazy engine and bundle budgets. Measure shell LCP/INP/CLS at the
75th percentile, targeting ≤2.5 s / ≤200 ms / ≤0.1; additionally measure time to
usable 3D, input responsiveness and fallback rate. A good shell score does not
establish a good WebGL experience. [Web Vitals](https://web.dev/articles/vitals)

Proposed 3D pilot targets: first useful room within 8 s on a recorded cold-cache
10 Mbps/100 ms profile, approximately 30 FPS during normal interaction on the
agreed midrange phones, no repeated context-loss loop, and functional 2D/contact
fallback. Test real Android Chrome and iPhone Safari devices supplied by the pilot,
screen rotation, background/resume, touch controls, reduced motion and keyboard
navigation. Headless screenshots are regression evidence, not mobile performance
evidence. Track actual asset bytes, draw calls and estimated decoded resource use.

Before public launch: restore a database and corresponding asset versions into a
clean environment; test a code rollback and compatible migration plan; alert on
viewer failures, oldest queued job, spend and undelivered leads. Record support
owner/runbook, backup retention and a proposed RPO ≤24 h / RTO ≤4 h, then verify
those recovery targets before selling them. A 99.5% pilot availability objective
is a target to instrument, not an SLA already achieved. Preserve a still-image/
floor-plan sales path through outages and asset failures.
