-- In-app messages: one-to-one conversations, group threads and a milestone's "Discuss" thread.
-- Additive only, safe on a populated database. Statements end with ";" at the end of a line; app/migrate.py splits on that.

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  subject text CHECK (subject IS NULL OR char_length(subject) <= 120),
  -- A milestone's discussion: at most one per milestone.
  milestone_id uuid UNIQUE REFERENCES milestones(id),
  is_group boolean NOT NULL DEFAULT false,
  -- One-to-one conversations only: the two user ids sorted and joined with ":", so each pair has exactly one.
  pair_key text UNIQUE,
  last_message_at timestamptz,
  CHECK (pair_key IS NULL OR NOT is_group)
);
CREATE INDEX IF NOT EXISTS conversations_latest ON conversations (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_participants_user ON conversation_participants (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- A thread page (newest first, keyset on created_at + id) and the per-sender rate limit.
CREATE INDEX IF NOT EXISTS messages_thread ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_sender_recent ON messages (sender_id, created_at DESC);
