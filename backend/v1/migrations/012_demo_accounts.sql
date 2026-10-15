-- Public demo accounts: a login whose password is published (the "Admin" demo button), with server-side limits.
-- is_public_demo marks it; app/public_demo.py lists what such an account may not do, and its sessions end five
-- minutes after sign-in however often they are refreshed.
-- Additive only, safe on a populated database: every existing account stays a normal one.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_public_demo boolean NOT NULL DEFAULT false;

-- When a public demo session ends for good. Set at sign-in and copied, never moved, onto each refreshed token.
-- NULL for everyone else (their sessions last the normal seven days).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_expires_at timestamptz;

-- Sign-in attempts on public demo accounts, per client address, for a modest rate limit (the accounts never lock,
-- since anyone could lock everyone else out of the demo). Rows older than a minute are deleted as new ones arrive.
CREATE TABLE IF NOT EXISTS demo_login_attempts (
  client text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_login_attempts_client ON demo_login_attempts (client, attempted_at);
