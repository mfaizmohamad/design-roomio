-- Approvals are immutable snapshots of one draft revision. Publication copies
-- the reviewed manifest so later home edits cannot alter an existing buyer link.
CREATE TABLE developer_release_approvals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  home_revision INTEGER NOT NULL CHECK (home_revision > 0),
  home_sha256 TEXT NOT NULL CHECK (home_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest JSONB NOT NULL,
  evidence JSONB NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_slot SMALLINT NOT NULL CHECK (approval_slot BETWEEN 1 AND 100),
  FOREIGN KEY (organization_id, project_id, home_id)
    REFERENCES developer_project_homes (organization_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, id),
  UNIQUE (project_id, approval_slot)
);

CREATE TABLE developer_releases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest JSONB NOT NULL,
  published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  release_slot SMALLINT NOT NULL CHECK (release_slot BETWEEN 1 AND 100),
  FOREIGN KEY (organization_id, project_id, approval_id)
    REFERENCES developer_release_approvals (organization_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, project_id, home_id)
    REFERENCES developer_project_homes (organization_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, id),
  UNIQUE (approval_id),
  UNIQUE (project_id, release_slot)
);

-- A release row never changes. Visibility/rollback are separate append-only
-- events so a retired link can be restored without rewriting historical data.
CREATE TABLE developer_release_events (
  id BIGSERIAL PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES developer_releases(id) ON DELETE RESTRICT,
  event_slot SMALLINT NOT NULL CHECK (event_slot BETWEEN 1 AND 100),
  action TEXT NOT NULL CHECK (action IN ('publish', 'retire', 'restore')),
  acted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, event_slot)
);
CREATE INDEX developer_release_events_latest_idx ON developer_release_events(release_id, id DESC);

CREATE FUNCTION reject_release_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'release snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER release_approvals_no_mutation BEFORE UPDATE OR DELETE ON developer_release_approvals
  FOR EACH ROW EXECUTE FUNCTION reject_release_snapshot_mutation();
CREATE TRIGGER releases_no_mutation BEFORE UPDATE OR DELETE ON developer_releases
  FOR EACH ROW EXECUTE FUNCTION reject_release_snapshot_mutation();
CREATE TRIGGER release_events_no_mutation BEFORE UPDATE OR DELETE ON developer_release_events
  FOR EACH ROW EXECUTE FUNCTION reject_release_snapshot_mutation();
