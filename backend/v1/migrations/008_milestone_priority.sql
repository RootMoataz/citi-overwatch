-- Milestone priority: low / medium / high / critical. How urgent or important a milestone is, separate from
-- difficulty (which weights progress); priority never changes progress. It orders auto-routing and the
-- deliverables lists and raises deadline insights.
-- Additive only; existing milestones become 'medium'.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high', 'critical'));
