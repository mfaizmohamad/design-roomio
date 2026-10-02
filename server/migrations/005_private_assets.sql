-- Private project assets are never inferred from personal uploads. Composite
-- tenant keys prevent a version from being attached to another project.
CREATE TABLE developer_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  brand TEXT CHECK (brand IS NULL OR char_length(brand) BETWEEN 1 AND 120),
  sku TEXT CHECK (sku IS NULL OR char_length(sku) BETWEEN 1 AND 120),
  asset_slot SMALLINT NOT NULL CHECK (asset_slot BETWEEN 1 AND 100),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES developer_projects (organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, project_id, id),
  UNIQUE (project_id, asset_slot)
);

CREATE TABLE developer_asset_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  version_slot SMALLINT NOT NULL CHECK (version_slot BETWEEN 1 AND 20),
  project_version_slot SMALLINT NOT NULL CHECK (project_version_slot BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'draft', 'approved')),
  rights_holder TEXT NOT NULL CHECK (char_length(rights_holder) BETWEEN 1 AND 120),
  rights_scope TEXT NOT NULL CHECK (rights_scope ~ '^(private-review|public-display)(,(private-review|public-display))*$'),
  rights_evidence_ref TEXT NOT NULL CHECK (char_length(rights_evidence_ref) BETWEEN 1 AND 200),
  measured_width_cm NUMERIC(9, 2) NOT NULL CHECK (measured_width_cm > 0 AND measured_width_cm <= 2000),
  measured_depth_cm NUMERIC(9, 2) NOT NULL CHECK (measured_depth_cm > 0 AND measured_depth_cm <= 2000),
  measured_height_cm NUMERIC(9, 2) NOT NULL CHECK (measured_height_cm > 0 AND measured_height_cm <= 2000),
  measurement_source TEXT NOT NULL CHECK (char_length(measurement_source) BETWEEN 1 AND 200),
  glb_bytes BYTEA,
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  byte_count INTEGER CHECK (byte_count IS NULL OR byte_count BETWEEN 1 AND 10485760),
  triangle_count INTEGER CHECK (triangle_count IS NULL OR triangle_count BETWEEN 0 AND 100000),
  texture_count SMALLINT CHECK (texture_count IS NULL OR texture_count BETWEEN 0 AND 16),
  decoded_texture_bytes INTEGER CHECK (decoded_texture_bytes IS NULL OR decoded_texture_bytes BETWEEN 0 AND 67108864),
  uploaded_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, asset_id)
    REFERENCES developer_assets (organization_id, project_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, project_id, id),
  UNIQUE (asset_id, version_slot),
  UNIQUE (project_id, project_version_slot),
  CHECK ((status = 'reserved' AND glb_bytes IS NULL AND sha256 IS NULL AND approved_by IS NULL)
      OR (status = 'draft' AND glb_bytes IS NOT NULL AND sha256 IS NOT NULL AND approved_by IS NULL)
      OR (status = 'approved' AND glb_bytes IS NOT NULL AND sha256 IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (glb_bytes IS NULL OR octet_length(glb_bytes) = byte_count)
);
CREATE INDEX developer_asset_versions_project_idx
  ON developer_asset_versions (organization_id, project_id, asset_id);

-- Once approved, even an accidental UPDATE cannot change the bytes, rights or
-- measured dimensions that a release may have pinned.
CREATE FUNCTION reject_approved_asset_version_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'approved asset version is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER approved_asset_version_no_update
  BEFORE UPDATE OR DELETE ON developer_asset_versions
  FOR EACH ROW EXECUTE FUNCTION reject_approved_asset_version_mutation();
