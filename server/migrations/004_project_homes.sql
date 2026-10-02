-- A project home is a separate snapshot. Personal designs remain in `designs`;
-- importing never reassigns their owner or makes later personal edits public.
CREATE TABLE developer_project_homes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  unit_type_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  home_slot SMALLINT NOT NULL CHECK (home_slot BETWEEN 1 AND 100),
  data JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_design_id TEXT,
  imported_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, unit_type_id)
    REFERENCES developer_unit_types (organization_id, project_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, project_id, id),
  -- This unique key, paired with a bounded free-slot insert, enforces the
  -- project ceiling even when two requests both see the final empty slot.
  UNIQUE (project_id, home_slot)
);
CREATE INDEX developer_project_homes_unit_type_idx
  ON developer_project_homes (organization_id, project_id, unit_type_id, updated_at DESC);
