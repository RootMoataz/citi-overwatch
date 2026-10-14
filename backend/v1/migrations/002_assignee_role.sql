-- Auto-routing after "Ready for review": someone can be on a milestone as a primary assignee or as support
-- added automatically. Additive only; existing assignments become 'primary'.
-- Statements end with ";" at the end of a line; app/migrate.py splits on that.
-- Notification types are plain text, so ENTRY_REJECTED, SUPPORT_ASSIGNED and SUPPORT_ROUTED need no change here.

ALTER TABLE milestone_assignees ADD COLUMN role text NOT NULL DEFAULT 'primary'
  CHECK (role IN ('primary', 'supporting'));
