-- Milestone difficulty: easy / medium / hard, weighted 1 / 2 / 3 in project progress and the BUDGET_BURN rule.
-- Additive only; existing milestones become 'medium', so their progress is unchanged.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'medium'
  CHECK (difficulty IN ('easy', 'medium', 'hard'));
