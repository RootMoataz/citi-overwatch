-- Hour-tracking safeguards: a start/stop timer, proof of work on hours, and red flags for the people who approve
-- them (LOGIC_WALKTHROUGH §28).
-- Additive only, safe on a populated database: existing entries count as manual (tracked_hours 0), need no note
-- (needs_note false) and stay exactly as they are. Statements end with ";" at the end of a line; app/migrate.py
-- splits on that.

-- The part of an entry's hours that came from timers (0 = all typed by hand, = hours = all tracked). A manual edit
-- keeps at most the new hours as tracked.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS tracked_hours numeric(5,2) NOT NULL DEFAULT 0
  CHECK (tracked_hours >= 0);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_tracked_within_hours CHECK (tracked_hours <= hours);
-- A timer stopped with no work note and no progress update that day: the hours are saved, the employee is asked to
-- add a note, and approvers see "No proof of work" until they do.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS needs_note boolean NOT NULL DEFAULT false;

-- Timers: one running per person (stopped_at IS NULL). work_date is the New York date the timer started on; a timer
-- still running after that day's midnight is stopped at 23:59:59 of it (auto_stopped). entry_id and logged_hours say
-- what the stop added to the timesheet (NULL / 0 when nothing was logged).
CREATE TABLE IF NOT EXISTS time_timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  work_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  auto_stopped boolean NOT NULL DEFAULT false,
  logged_hours numeric(5,2),
  entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL,
  CHECK (stopped_at IS NULL OR stopped_at >= started_at),
  CHECK (NOT auto_stopped OR stopped_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS time_timers_one_running ON time_timers (user_id) WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS time_timers_user ON time_timers (user_id, started_at DESC);

-- Named settings. hour_flags_live_since: when the red flags went live. NO_ACTIVITY and BACKDATED judge only entries
-- created from then on, so hours logged before the feature existed (all of the demo history) never light up.
CREATE TABLE IF NOT EXISTS app_settings (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (name, value) VALUES ('hour_flags_live_since', CAST(clock_timestamp() AS text))
  ON CONFLICT (name) DO NOTHING;
