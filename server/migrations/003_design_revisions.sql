-- A monotonic row revision makes simultaneous editor saves compare-and-swap.
-- updated_at is not a safe token: two writes may share a timestamp precision.
ALTER TABLE designs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE designs ADD CONSTRAINT designs_revision_positive CHECK (revision > 0);
