-- Timer workflow (LOGIC_WALKTHROUGH §28): stopping a timer no longer submits hours, timer cells are locked, change
-- requests, a live feed of running timers and over-limit alerts.
-- Additive only, safe on a populated database: timers stopped before this migration already logged their hours into
-- an entry (entry_id, logged_hours) and keep tracked_hours 0 here, so none of them turns into a draft. A timer running
-- at deploy time is stopped by the new code and becomes a draft. Statements end with ";" at the end of a line;
-- app/migrate.py splits on that.

-- tracked_hours: the rounded hours a stop recorded (0 while running or when nothing was recorded). Until submitted_at is
-- set they are a draft of that day's cell, shown pre-filled on the timesheet; Save week (or an approved change request)
-- submits them into the entry entry_id. note: the optional note given at the stop, pre-filling the cell's work note.
-- stopped_by / stop_message: a manager or admin stopped it from the live feed, with this message.
ALTER TABLE time_timers ADD COLUMN IF NOT EXISTS tracked_hours numeric(5,2) NOT NULL DEFAULT 0
  CHECK (tracked_hours >= 0 AND tracked_hours <= 24);
ALTER TABLE time_timers ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE time_timers ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500);
ALTER TABLE time_timers ADD COLUMN IF NOT EXISTS stopped_by uuid REFERENCES users(id);
ALTER TABLE time_timers ADD COLUMN IF NOT EXISTS stop_message text CHECK (stop_message IS NULL OR char_length(stop_message) <= 500);
CREATE INDEX IF NOT EXISTS time_timers_drafts ON time_timers (user_id, work_date)
  WHERE submitted_at IS NULL AND tracked_hours > 0;

-- Over-limit alerts already sent to the approvers: once per timer and limit kind (daily, milestone, weekly).
CREATE TABLE IF NOT EXISTS time_timer_alerts (
  timer_id uuid NOT NULL REFERENCES time_timers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('daily', 'milestone', 'weekly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (timer_id, kind)
);

-- An employee asking to change the hours of a locked (timer) cell. One pending request per cell. Approving applies the
-- requested hours as a pending entry (entry_id); rejecting leaves the cell as it is. decision_comment is optional.
CREATE TABLE IF NOT EXISTS time_edit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  work_date date NOT NULL,
  current_hours numeric(5,2) NOT NULL CHECK (current_hours >= 0 AND current_hours <= 24),
  requested_hours numeric(5,2) NOT NULL CHECK (requested_hours > 0 AND requested_hours <= 24),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_comment text CHECK (decision_comment IS NULL OR char_length(decision_comment) <= 500),
  entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS time_edit_requests_one_pending ON time_edit_requests (user_id, milestone_id, work_date)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS time_edit_requests_project ON time_edit_requests (project_id, status);
