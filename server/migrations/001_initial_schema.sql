-- 001_initial_schema.sql — users, sessions, designs (+ their secondary indexes).
--
-- This is a VERBATIM copy of the DDL the old `initDb()` ran on every boot, kept
-- statement-for-statement so that applying it produces exactly the schema every
-- existing Roomio database already has.
--
-- `IF NOT EXISTS` is load-bearing HERE AND ONLY HERE. Every database created by
-- the old boot-time bootstrap already has these five objects but no
-- `schema_migrations` row, so the runner will offer this file to them exactly
-- once; without `IF NOT EXISTS` that adoption run would abort with
-- "relation \"users\" already exists" and the deploy would fail.
--
-- DO NOT COPY THIS PATTERN INTO 002+. `IF NOT EXISTS` on a later migration
-- silently does nothing when the object is already present but WRONG, which is
-- precisely the failure mode (a schema change that no-ops) that replacing
-- `initDb()` was meant to eliminate.

-- users — one row per account. email is stored lowercased and is unique.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- sessions — one row per active login. Cascade-deletes with the owning user.
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- designs — one row per saved RoomDesign. `id` is the client-generated
-- RoomDesign.id; `data` holds the full design JSON. Cascade-deletes with user.
CREATE TABLE IF NOT EXISTS designs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT,
  shape      TEXT,
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Helpful secondary indexes for the common access patterns: listing a user's
-- designs newest-first, and resolving a session by user.
CREATE INDEX IF NOT EXISTS designs_user_id_idx ON designs (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
