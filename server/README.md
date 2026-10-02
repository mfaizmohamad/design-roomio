# Roomio Server

Standalone authentication, session, and designs backend for the Roomio
room-designer. Plain Express + PostgreSQL, no ORM, ES modules.

## Stack

- **Express 4** — HTTP + routing
- **pg** — PostgreSQL client (connection pool)
- **bcryptjs** — password hashing (10 rounds)
- **cookie-parser** — reads the session cookie

## Running

```bash
cd server
npm install
npm run migrate      # apply server/migrations/*.sql — required before first start
npm start            # listens on PORT (default 5181)
```

In dev the front-end runs on Vite (`:5180`) and proxies `/api/*` to this
server, so it is effectively same-origin and no CORS is required.

### Environment variables

| Var                      | Default                         | Purpose                                      |
| ------------------------ | ------------------------------- | -------------------------------------------- |
| `PORT`                   | `5181`                          | Port the server listens on                   |
| `DATABASE_URL`           | `postgresql://localhost/roomio` | PostgreSQL connection string (app: DML only) |
| `MIGRATION_DATABASE_URL` | falls back to `DATABASE_URL`    | Connection used by `npm run migrate` only    |

`server/.env.example` documents every knob, including the security ones.

## Migrations

The schema is a set of numbered SQL files in `server/migrations/`, applied by
`npm run migrate` (`migrate.js`, no dependency beyond `pg`). It is an explicit
**deploy step that runs before the app starts** — the app process issues no DDL
at all, and refuses to boot while a migration is pending rather than serving
500s from a stale schema.

- Applied migrations are recorded in `schema_migrations` (version, filename,
  sha256, applied time), so re-running is a no-op and the order is fixed.
- Each migration runs in its own transaction together with its bookkeeping row:
  a half-applied migration is impossible.
- Concurrent runners (N instances deploying at once) serialise on a Postgres
  advisory lock.
- Editing a migration that has already run is refused — the checksum no longer
  matches. Add a new file instead.

To add one: `002_short_snake_case_name.sql`. Do **not** copy `IF NOT EXISTS`
from `001` — it is there only so the migration can adopt databases the old
boot-time bootstrap created, and on a later migration it silently turns a schema
change into a no-op.

## Database schema

- **users** — `id` (UUID text PK), `email` (unique, lowercased), `password_hash`,
  `name`, `created_at`
- **sessions** — `sid` (UUID text PK), `user_id` (FK → users, cascade),
  `created_at`, `expires_at`
- **designs** — `id` (client RoomDesign id, PK), `user_id` (FK → users, cascade),
  `name`, `shape`, `data` (JSONB, full RoomDesign), `created_at`, `updated_at`
- **organizations / organization_memberships** — developer workspaces with
  owner, admin, editor, publisher, or sales membership
- **developer_projects / developer_unit_types / developer_units** — project and
  sellable-unit hierarchy; composite foreign keys keep units inside their tenant

Legacy `designs` remain personal. Joining or creating an organization does not
expose an existing design to its other members.

## Sessions

On signup/login the server inserts a `sessions` row with
`expires_at = now() + 30 days` and sets an httpOnly cookie:

```
roomio_sid=<sid>; Path=/; SameSite=Lax; Max-Age=2592000
```

The cookie is **not** `secure` so it works over plain http in local dev.
`requireAuth` reads the cookie, looks up a non-expired session, and attaches
`req.user = { id, email, name }`; otherwise it responds `401 { error: 'unauthorized' }`.
Logout deletes the session row and clears the cookie.

## API

Requests/responses are JSON except private GLB uploads/downloads. Errors return a helpful `{ error }` with an
appropriate status code. Any thrown error becomes a JSON `500` (the process
never crashes). Dates are returned as **epoch milliseconds**.

### Auth

| Method | Path               | Auth | Body                      | Success                        |
| ------ | ------------------ | ---- | ------------------------- | ------------------------------ |
| POST   | `/api/auth/signup` | no   | `{ email, password, name? }` | `200 { user: {id,email,name} }` |
| POST   | `/api/auth/login`  | no   | `{ email, password }`     | `200 { user }`                 |
| POST   | `/api/auth/logout` | no   | —                         | `200 { ok: true }`             |
| GET    | `/api/auth/me`     | yes  | —                         | `200 { user }`                 |

- **signup** validates email format and `password.length >= 6`; returns `400`
  on invalid input, `409` if the email is already registered.
- **login** returns `401 { error: 'invalid credentials' }` on bad email or
  password (same message either way, so registered emails aren't leaked).

### Designs (all require auth)

| Method | Path               | Body                | Success                                                  |
| ------ | ------------------ | ------------------- | -------------------------------------------------------- |
| GET    | `/api/designs`     | —                   | `200 [{ id, name, shape, updatedAt, createdAt }]` newest first |
| GET    | `/api/designs/:id` | —                   | `200 <full design JSON>` plus `X-Design-Revision`, `404` if not owned/found |
| POST   | `/api/designs`     | full design JSON    | `200 { ok: true, id }` plus `X-Design-Revision`; `409` on stale revision |
| DELETE | `/api/designs/:id` | —                   | `200 { ok: true }`                                       |

Whole-home records (`house.version: 1`) require `X-Design-Revision: 0` on
creation and the revision returned by GET/POST on later saves. A missing header
returns 428; stale revisions return 409 without overwriting the saved home.
Legacy single-room clients can still save without a revision header, but cannot
overwrite an existing whole-home record that way. Designs have a 1.5 MB JSON
ceiling; whole homes are validated before storage (up to 100 rooms, 20 levels,
and 100 furnishings, openings or lights per room).

- **POST** upserts by `RoomDesign.id`. If a row with that id exists under a
  **different** user it returns `403 { error: 'forbidden' }`; otherwise it
  inserts (or updates the owner's row) and sets `updated_at = now()`.
- **DELETE** is idempotent and only affects rows owned by the caller.

### Developer workspace (all require auth)

| Method | Path | Body | Allowed roles |
| ------ | ---- | ---- | ------------- |
| GET / POST | `/api/orgs` | POST `{ name }` | Any signed-in user (up to 10 owned orgs) |
| GET | `/api/orgs/:orgId` | — | Any member |
| GET / POST | `/api/orgs/:orgId/members` | POST `{ userId, role }` | GET: member; POST: owner/admin |
| DELETE | `/api/orgs/:orgId/members/:userId` | — | Owner/admin; owner cannot be removed |
| GET / POST | `/api/orgs/:orgId/projects` | POST `{ name }` | GET: member; POST: owner/admin |
| GET | `/api/orgs/:orgId/projects/:projectId` | — | Any member |
| GET / POST | `/api/orgs/:orgId/projects/:projectId/unit-types` | POST `{ name }` | GET: member; POST: owner/admin/editor |
| GET / POST | `/api/orgs/:orgId/projects/:projectId/units` | POST `{ label, unitTypeId }` | GET: member; POST: owner/admin/editor |

Nonmembers receive `404`, including for IDs they guess. Every route rechecks
membership from the database, so revocation takes effect without logging out.
Writes are limited to 50 members and projects per organization, 100 unit types
and 1,000 units per project. Public releases and whole-home drafts use separate
routes built on this access hierarchy.

### Private furniture assets (all require current project membership)

Let `B = /api/orgs/:orgId/projects/:projectId/assets`. These routes store binary
GLBs in private PostgreSQL rows; they never fetch an upload URL or expose an
unreviewed file to the buyer viewer.

| Method | Path | Body | Allowed roles |
| ------ | ---- | ---- | ------------- |
| GET / POST | `B` | POST `{ name, brand?, sku? }` | GET: member; POST: owner/admin/editor |
| GET / POST | `B/:assetId/versions` | POST rights and measurements below | GET: member; POST: owner/admin/editor |
| GET | `B/:assetId/versions/:versionId` | — | Member; metadata only |
| PUT | `B/:assetId/versions/:versionId/content` | `Content-Type: model/gltf-binary`, raw GLB | Owner/admin/editor; reserved version only |
| POST | `B/:assetId/versions/:versionId/approve` | — | Owner/admin/publisher, different from uploader |
| GET | `B/:assetId/versions/:versionId/content` | — | Member; approved version only |

Version reservation needs `rightsHolder`, `rightsScope` (`private-review`,
`public-display`, or both comma-delimited), `rightsEvidenceRef`,
`measuredWidthCm`, `measuredDepthCm`, `measuredHeightCm`, and
`measurementSource`. Physical measurements are stored independently of mesh
bounds. Rights evidence is a supplied reference that the independent reviewer
must verify; the API does not inspect that record or infer permission from a URL
or a GLB. Approval freezes the version hash,
bytes and metadata. Uploads are capped at 10 MiB, 100,000 triangles, 16 embedded
PNG/JPEG textures, 64 MiB estimated decoded texture bytes, 100 asset identities
and 100 total versions per project, and 20 versions per identity. External resources and unsupported
extensions are rejected. The binary GET sends `Cache-Control: private, no-store`.

### Reviewed source packages and releases

The authenticated `/developer` workspace lists organizations, project homes,
private assets and release state. `GET /api/orgs/:orgId/projects/:projectId/releases`
returns at most 100 `{ id, homeId, state, createdAt }` rows for current members;
it never returns private source evidence or a draft manifest.

Let `S = /api/orgs/:orgId/projects/:projectId/homes/:homeId/source-packages`.
`GET S` lists private metadata for owner/admin/publisher. `POST S` stores a
bounded draft with source revision, document references, public-display rights
and claim-to-document references. The creator may `PUT S/:packageId` with a
revision token, then `POST S/:packageId/submit`. A **different** owner/admin
reviews it through `POST S/:packageId/review` with `{ decision, reviewRef }`.
Submitted packages and reviews are immutable. The API stores references, not
scans; a reviewer must inspect originals in the access-controlled source system.

`POST /api/orgs/:orgId/projects/:projectId/homes/:homeId/approvals` now requires
`{ sourcePackageId }` for an approved package matching the exact home revision.
`POST .../releases` requires `{ approvalId }`. Historical self-attested releases
are denied by public GET after migration 007; plan a link inventory and re-review
before deploying that migration. The bundled Embercrest prototype remains blocked.

### Buyer enquiries

`POST /api/releases/:releaseId/enquiries` accepts a random UUID
`idempotencyKey`, name, email or international-format phone, explicit
`contactConsent: { accepted: true, noticeVersion: 'pilot-v1' }`, separate
`marketingConsent`, and optional message. Only a published, source-reviewed
release accepts enquiries. The response contains an enquiry ID and storage
state, never contact details. Repeating the same key and payload returns the
same logical enquiry; a per-IP limiter and 500-row/release database cap apply.
`DELETE /api/releases/enquiries/:enquiryId` with `X-Enquiry-Key` removes contact
fields and cancels the queued intent when the buyer retains that key.

Current owner/admin/publisher/sales members can list their project's enquiries
through `GET /api/orgs/:orgId/projects/:projectId/enquiries` (100 per page),
and update contact status. Owner/admin can replay a failed intent or delete
contact fields. The outbox is durable **intent**, not CRM delivery: no sender,
delivery acknowledgement, retention worker or real-pilot privacy notice is
configured yet. A future CRM integration must handle deletion of copies already
sent downstream.

### Misc

| Method | Path          | Auth | Success            |
| ------ | ------------- | ---- | ------------------ |
| GET    | `/api/health` | no   | `200 { ok: true }` |

Unknown `/api/*` routes return `404 { error: 'not found' }`.

## File layout

- `index.js` — Express app, all routes, error handling, boot
- `auth.js` — password hashing/verification, session create/lookup/destroy,
  `requireAuth` middleware, cookie handling
- `db.js` — pg `Pool` and the `query()` helper. Issues no DDL.
- `migrate.js` — migration runner (`npm run migrate`) + the boot-time
  "is the schema current?" check
- `migrations/` — numbered `.sql` files; the schema's source of truth
- `pgssl.js` — shared TLS policy for every connection this package opens
