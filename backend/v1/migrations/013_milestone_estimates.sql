-- Expected effort per milestone: total person-hours the work should take. Optional (NULL = no estimate yet).
-- Durations and the project's total estimate are derived from dates and these values, never stored.
-- Additive only; existing milestones keep NULL until someone (or demo_curate) sets an estimate.
-- Numbered 013 because 009-012 are reserved for other branches; app/migrate.py applies files in name order, once each.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS estimated_hours numeric(7,1)
  CHECK (estimated_hours IS NULL OR (estimated_hours > 0 AND estimated_hours <= 10000));
