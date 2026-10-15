-- Planning board (LOGIC_WALKTHROUGH §22): while a project is 'planned', its milestones sit in planning columns
-- (backlog -> ready -> scheduled) in an order the manager sets; finalizing the plan stamps plan_finalized_at
-- and moves the project to 'active'.
-- Additive only. Existing milestones count as already scheduled, numbered 1, 2, 3... per project by end date.
-- A new milestone with no sequence goes to the end of its column (the trigger below).
-- Statements end with ";" at the end of a line; app/migrate.py splits on that, so the trigger function's body
-- is kept on one line.

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS plan_column text NOT NULL DEFAULT 'scheduled'
  CHECK (plan_column IN ('backlog', 'ready', 'scheduled'));
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS sequence integer CHECK (sequence >= 0);

UPDATE milestones m SET sequence = ranked.n
  FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY end_date, start_date, lower(name), id) AS n
        FROM milestones) ranked
  WHERE ranked.id = m.id AND m.sequence IS NULL;

CREATE OR REPLACE FUNCTION milestones_next_sequence() RETURNS trigger AS $$ BEGIN IF NEW.sequence IS NULL THEN SELECT coalesce(max(sequence), 0) + 1 INTO NEW.sequence FROM milestones WHERE project_id = NEW.project_id AND plan_column = NEW.plan_column; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER milestones_next_sequence BEFORE INSERT ON milestones
  FOR EACH ROW EXECUTE FUNCTION milestones_next_sequence();

ALTER TABLE milestones ALTER COLUMN sequence SET NOT NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_finalized_at timestamptz;
