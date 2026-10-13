-- Citi Overwatch initial schema (spec §6).
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee');
CREATE TYPE project_status AS ENUM ('planned', 'active', 'on_hold', 'completed');
CREATE TYPE milestone_status AS ENUM ('not_started', 'in_progress', 'ready_for_review', 'completed');
CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE entry_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  job_title text NOT NULL DEFAULT '',
  role user_role NOT NULL DEFAULT 'employee',
  salary numeric(12,2) NOT NULL DEFAULT 0 CHECK (salary >= 0),
  manager_id uuid REFERENCES users(id),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  temp_password_expires_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
CREATE INDEX users_manager ON users (manager_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

CREATE TABLE password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_codes_user ON password_reset_codes (user_id, created_at DESC);

CREATE TABLE app_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  predicted_end_date date NOT NULL,
  budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  status project_status NOT NULL DEFAULT 'planned',
  manager_id uuid NOT NULL REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  completed_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (predicted_end_date >= start_date)
);
CREATE UNIQUE INDEX projects_name_active ON projects (lower(name)) WHERE NOT is_archived;
CREATE INDEX projects_manager ON projects (manager_id);

CREATE TABLE project_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  proposed_start date NOT NULL,
  proposed_end date NOT NULL,
  proposed_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (proposed_budget >= 0),
  reason text NOT NULL,
  status request_status NOT NULL DEFAULT 'pending',
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_comment text,
  project_id uuid REFERENCES projects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proposed_end >= proposed_start)
);

CREATE TABLE project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  planned_hours_per_week numeric(4,1) NOT NULL CHECK (planned_hours_per_week > 0 AND planned_hours_per_week <= 40),
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members (user_id);

CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status milestone_status NOT NULL DEFAULT 'not_started',
  completed_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX milestones_project ON milestones (project_id);

CREATE TABLE milestone_dependencies (
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  depends_on_id uuid NOT NULL REFERENCES milestones(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (milestone_id, depends_on_id),
  CHECK (milestone_id <> depends_on_id)
);

CREATE TABLE milestone_assignees (
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (milestone_id, user_id)
);
CREATE INDEX milestone_assignees_user ON milestone_assignees (user_id);

CREATE TABLE milestone_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milestone_notes_milestone ON milestone_notes (milestone_id, created_at);

CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  milestone_id uuid NOT NULL REFERENCES milestones(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  work_date date NOT NULL,
  hours numeric(5,2) NOT NULL CHECK (hours BETWEEN 0.25 AND 24),
  status entry_status NOT NULL DEFAULT 'pending',
  over_40 boolean NOT NULL DEFAULT false,
  edited_after_decision boolean NOT NULL DEFAULT false,
  hourly_rate numeric(10,2),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  rejection_reason text,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone_id, work_date),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE INDEX time_entries_user_date ON time_entries (user_id, work_date);
CREATE INDEX time_entries_project_status ON time_entries (project_id, status);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  subject_user_id uuid REFERENCES users(id),
  week_start date,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, subject_user_id, week_start)
);
CREATE INDEX notifications_recipient ON notifications (recipient_id, read_at);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  changes jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log (created_at DESC);
