-- Profile photos. The sanitised PNG lives in its own table so the many "SELECT * FROM users" reads never drag
-- image bytes along; users.avatar_updated_at says whether there is one and versions its URL for cache busting.
-- Additive only. Statements end with ";" at the end of a line; app/migrate.py splits on that.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS user_avatars (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  png bytea NOT NULL CHECK (octet_length(png) <= 1048576),
  updated_at timestamptz NOT NULL DEFAULT now()
);
