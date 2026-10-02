-- Staff source evidence is private. A reviewed package is bound to the exact
-- home revision/hash; a later edit requires another package and second review.
CREATE TABLE developer_source_packages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  home_revision INTEGER NOT NULL CHECK (home_revision > 0),
  home_sha256 TEXT NOT NULL CHECK (home_sha256 ~ '^[0-9a-f]{64}$'),
  package_slot SMALLINT NOT NULL CHECK (package_slot BETWEEN 1 AND 100),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  source_revision TEXT NOT NULL CHECK (char_length(source_revision) BETWEEN 1 AND 160),
  documents JSONB NOT NULL,
  source_rights JSONB NOT NULL,
  claims JSONB NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  FOREIGN KEY (organization_id, project_id, home_id)
    REFERENCES developer_project_homes (organization_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, project_id, id),
  UNIQUE (project_id, package_slot),
  CHECK ((status = 'draft' AND submitted_by IS NULL AND submitted_at IS NULL)
      OR (status = 'submitted' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE INDEX developer_source_packages_home_idx ON developer_source_packages
  (organization_id, project_id, home_id);

CREATE TABLE developer_source_reviews (
  package_id TEXT PRIMARY KEY REFERENCES developer_source_packages(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  review_ref TEXT NOT NULL CHECK (char_length(review_ref) BETWEEN 1 AND 160),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION guard_source_package_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'submitted source packages are immutable';
  END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR
     NEW.project_id <> OLD.project_id OR NEW.home_id <> OLD.home_id OR
     NEW.home_revision <> OLD.home_revision OR NEW.home_sha256 <> OLD.home_sha256 OR
     NEW.package_slot <> OLD.package_slot OR NEW.created_by <> OLD.created_by OR
     NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'source package identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER source_packages_guard BEFORE UPDATE OR DELETE ON developer_source_packages
  FOR EACH ROW EXECUTE FUNCTION guard_source_package_mutation();
CREATE TRIGGER source_reviews_no_mutation BEFORE UPDATE OR DELETE ON developer_source_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_release_snapshot_mutation();

-- Existing approvals remain as historical records, but publication now requires
-- a non-null reviewed package. The route also rejects legacy approval rows.
ALTER TABLE developer_release_approvals ADD COLUMN source_package_id TEXT
  REFERENCES developer_source_packages(id) ON DELETE RESTRICT;
