-- "Log hours manually" (spec 2026-10-17). Additive: existing entries keep NULL = not a manual request.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS manual_reason text CHECK (manual_reason IS NULL OR manual_reason IN
  ('forgot_timer', 'away_from_computer', 'meeting_or_call', 'timer_problem', 'other'));
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS manual_details text
  CHECK (manual_details IS NULL OR char_length(manual_details) <= 500);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_manual_details_need_reason
  CHECK (manual_details IS NULL OR manual_reason IS NOT NULL);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_manual_other_details
  CHECK (manual_reason IS DISTINCT FROM 'other' OR char_length(coalesce(manual_details, '')) >= 10);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_manual_untracked CHECK (manual_reason IS NULL OR tracked_hours = 0);
CREATE INDEX IF NOT EXISTS time_entries_manual_pending ON time_entries (project_id)
  WHERE manual_reason IS NOT NULL AND status = 'pending';
