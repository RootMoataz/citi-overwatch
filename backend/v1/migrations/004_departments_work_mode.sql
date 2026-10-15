-- Departments (admin-managed) for people and projects, and push/pull work mode per project.
-- Additive only: existing people and projects have no department, and every existing project stays 'push'.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower ON departments (lower(name));

ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS users_department ON users (department_id);
CREATE INDEX IF NOT EXISTS projects_department ON projects (department_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'push'
  CHECK (work_mode IN ('push', 'pull'));
