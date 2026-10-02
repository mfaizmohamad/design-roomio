-- Developer work lives in explicit organizations. Legacy designs remain owned
-- by users until a deliberate import; silently attaching them would expose a
-- personal design to every colleague in the new organization.
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_slot SMALLINT NOT NULL CHECK (owner_slot BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, owner_slot)
);

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'publisher', 'sales')),
  member_slot SMALLINT NOT NULL CHECK (member_slot BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  UNIQUE (organization_id, member_slot)
);
CREATE INDEX organization_memberships_user_idx ON organization_memberships (user_id);

CREATE TABLE developer_projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  project_slot SMALLINT NOT NULL CHECK (project_slot BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, project_slot)
);
CREATE INDEX developer_projects_org_idx ON developer_projects (organization_id);

CREATE TABLE developer_unit_types (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  type_slot SMALLINT NOT NULL CHECK (type_slot BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES developer_projects (organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, project_id, id),
  UNIQUE (project_id, type_slot)
);
CREATE INDEX developer_unit_types_project_idx ON developer_unit_types (organization_id, project_id);

CREATE TABLE developer_units (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  unit_type_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  unit_slot SMALLINT NOT NULL CHECK (unit_slot BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id, unit_type_id)
    REFERENCES developer_unit_types (organization_id, project_id, id) ON DELETE CASCADE,
  UNIQUE (project_id, label),
  UNIQUE (project_id, unit_slot)
);
CREATE INDEX developer_units_project_idx ON developer_units (organization_id, project_id);
