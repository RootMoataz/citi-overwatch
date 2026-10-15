-- Timesheets for managers and admins, HR (payroll) submissions, and simpler project requests.
-- Additive and safe on a populated database: nothing is dropped and every existing row keeps its data.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

-- Who keeps a personal timesheet. Employees always log hours; a manager or admin only when this is on. Executives
-- never log (they are read-only). Managers and admins who already logged hours keep their timesheet.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tracks_own_hours boolean NOT NULL DEFAULT false;
UPDATE users SET tracks_own_hours = true WHERE role = 'employee';
UPDATE users u SET tracks_own_hours = true
  WHERE u.role IN ('manager', 'admin') AND EXISTS (SELECT 1 FROM time_entries t WHERE t.user_id = u.id);

-- Project requests no longer ask for a reason. The column stays (older requests keep theirs) but is optional.
-- A request can now name the department and work mode the project will start with.
ALTER TABLE project_requests ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE project_requests ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE project_requests ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'push'
  CHECK (work_mode IN ('push', 'pull'));

-- One HR submission: the approved hours of a pay period handed over for payroll (exported as a CSV; there is no
-- HR system to send them to). A re-submission also carries corrections to hours sent earlier and points at the
-- earlier submission it corrects. Totals are a snapshot taken when it was submitted.
CREATE TABLE IF NOT EXISTS hr_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  entry_count integer NOT NULL CHECK (entry_count > 0),
  correction_count integer NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
  total_hours numeric(10,2) NOT NULL CHECK (total_hours >= 0),
  total_cost numeric(14,2) NOT NULL CHECK (total_cost >= 0),
  resubmission_of uuid REFERENCES hr_submissions(id),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS hr_submissions_submitted ON hr_submissions (submitted_at DESC);

-- What each submission sent, row by row, as it was then: the payroll CSV is rebuilt from this, so later edits to an
-- entry never change what an earlier submission said. A correction row re-sends an entry changed after it went to
-- HR (0 hours when it was rejected since) and keeps the hours sent before.
CREATE TABLE IF NOT EXISTS hr_submission_entries (
  submission_id uuid NOT NULL REFERENCES hr_submissions(id),
  entry_id uuid NOT NULL REFERENCES time_entries(id),
  hours numeric(5,2) NOT NULL CHECK (hours >= 0),
  hourly_rate numeric(10,2),
  cost numeric(12,2) NOT NULL CHECK (cost >= 0),
  is_correction boolean NOT NULL DEFAULT false,
  previous_submission_id uuid REFERENCES hr_submissions(id),
  previous_hours numeric(5,2),
  PRIMARY KEY (submission_id, entry_id),
  CHECK (is_correction = (previous_submission_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS hr_submission_entries_entry ON hr_submission_entries (entry_id);

-- Submitted hours are NOT locked: the normal rules still apply (an employee's edit sends them back for approval).
-- An entry changed after it went to HR keeps hr_submission_id (its latest submission) and is flagged until an admin
-- re-sends it in a new submission.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hr_submission_id uuid REFERENCES hr_submissions(id);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hr_submitted_at timestamptz;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS changed_after_hr_submission boolean NOT NULL DEFAULT false;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hr_changed_at timestamptz;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_hr_change_needs_submission
  CHECK (NOT changed_after_hr_submission OR hr_submission_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS time_entries_hr_changed ON time_entries (hr_submission_id)
  WHERE changed_after_hr_submission;
CREATE INDEX IF NOT EXISTS time_entries_status_date ON time_entries (status, work_date);
