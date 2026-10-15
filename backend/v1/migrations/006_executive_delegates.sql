-- Executive role (read-only leadership) and a per-project delegate approver for time approvals.
-- Additive only, safe on a populated database: existing users keep their role, existing projects get no delegate.
-- ADD VALUE inside the migration's transaction is fine on PostgreSQL 12+ as long as nothing here uses the new value.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'executive';

-- One delegate per project: an active manager or admin (checked by the API) who may decide the project's pending
-- hours while delegate_until is empty or today or later. No delegate means no end date either.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delegate_approver_id uuid REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delegate_until date;
ALTER TABLE projects ADD CONSTRAINT projects_delegate_until_needs_delegate
  CHECK (delegate_until IS NULL OR delegate_approver_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS projects_delegate ON projects (delegate_approver_id) WHERE delegate_approver_id IS NOT NULL;
