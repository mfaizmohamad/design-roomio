-- A buyer's contact details never enter release manifests or outbox payloads.
-- The idempotency hash remains after withdrawal so retries cannot resurrect PII.
CREATE TABLE developer_enquiries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  release_id TEXT NOT NULL REFERENCES developer_releases(id) ON DELETE RESTRICT,
  enquiry_slot SMALLINT NOT NULL CHECK (enquiry_slot BETWEEN 1 AND 500),
  idempotency_hash TEXT NOT NULL CHECK (idempotency_hash ~ '^[0-9a-f]{64}$'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  name TEXT,
  email TEXT,
  phone TEXT,
  message TEXT,
  notice_version TEXT NOT NULL,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  contact_consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, project_id, release_id)
    REFERENCES developer_releases(organization_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (release_id, enquiry_slot),
  UNIQUE (release_id, idempotency_hash),
  CHECK ((status = 'withdrawn' AND name IS NULL AND email IS NULL AND phone IS NULL AND message IS NULL AND withdrawn_at IS NOT NULL)
    OR (status <> 'withdrawn' AND name IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL) AND withdrawn_at IS NULL))
);
CREATE INDEX developer_enquiries_project_idx ON developer_enquiries(organization_id, project_id, created_at DESC);

-- One durable intent per logical enquiry. A later worker must use id as its
-- downstream idempotency key and transactionally record acknowledgement.
CREATE TABLE developer_enquiry_outbox (
  enquiry_id TEXT PRIMARY KEY REFERENCES developer_enquiries(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'failed', 'delivered', 'cancelled')),
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (char_length(coalesce(last_error, '')) <= 300)
);
CREATE INDEX developer_enquiry_outbox_pending_idx ON developer_enquiry_outbox(state, updated_at)
  WHERE state IN ('pending', 'failed');
