-- Milestone workflow: richer milestones (objective, completion criteria, required skills), a skills catalogue and
-- people's skills, progress updates, kickbacks with a new 'blocked' status, and skill-aware auto-routing.
-- Additive only, safe on a populated database: existing milestones get an empty objective and criteria and no
-- required skills (so anyone on the team qualifies), nobody has skills yet, and no milestone is blocked.
-- ADD VALUE inside the migration's transaction is fine on PostgreSQL 12+ as long as nothing here uses the new value.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

-- 'blocked': an assignee kicked the milestone back and it waits for its manager's review (milestone_kickbacks).
ALTER TYPE milestone_status ADD VALUE IF NOT EXISTS 'blocked';

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS objective text NOT NULL DEFAULT ''
  CHECK (char_length(objective) <= 300);
-- One checklist item per line.
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS completion_criteria text NOT NULL DEFAULT ''
  CHECK (char_length(completion_criteria) <= 4000);

-- The skills catalogue, managed by admins. Archiving hides a skill from pickers; people and milestones keep it.
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS skills_name_lower ON skills (lower(name));

INSERT INTO skills (name) VALUES ('QA'), ('Frontend Development'), ('Backend Development'), ('UI/UX Design'),
  ('DevOps'), ('Data Engineering'), ('Business Analysis'), ('Project Management')
  ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS user_skills (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  added_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill_id)
);
CREATE INDEX IF NOT EXISTS user_skills_skill ON user_skills (skill_id);

-- A milestone's required skills: someone needs at least one of them to be auto-routed to it. None: anyone qualifies.
CREATE TABLE IF NOT EXISTS milestone_skills (
  milestone_id uuid NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (milestone_id, skill_id)
);
CREATE INDEX IF NOT EXISTS milestone_skills_skill ON milestone_skills (skill_id);

-- Progress updates (the work log): assignees, the project's manager and admins post; whoever sees the milestone reads.
CREATE TABLE IF NOT EXISTS milestone_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  percent_complete integer CHECK (percent_complete BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS milestone_updates_milestone ON milestone_updates (milestone_id, created_at DESC);

-- Kickbacks: an assignee sends a milestone back to its manager with a reason; the manager (or admin, or the active
-- delegate) resolves it by returning it to the team (in progress) or putting it back in the queue (not started).
CREATE TABLE IF NOT EXISTS milestone_kickbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  raised_by uuid NOT NULL REFERENCES users(id),
  category text NOT NULL CHECK (category IN ('blocker', 'technical_issue', 'unclear_requirement', 'other')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 2000),
  -- The status it was in when kicked back, so the history can say where it came from.
  previous_status text NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES users(id),
  resolution text CHECK (resolution IN ('returned', 'requeued')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 1 AND 2000),
  resolved_at timestamptz,
  CHECK ((resolved_at IS NULL) = (resolution IS NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL))
);
-- At most one open kickback per milestone.
CREATE UNIQUE INDEX IF NOT EXISTS milestone_kickbacks_open ON milestone_kickbacks (milestone_id)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS milestone_kickbacks_milestone ON milestone_kickbacks (milestone_id, raised_at DESC);
