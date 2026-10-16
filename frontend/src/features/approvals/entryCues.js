import { STATUS } from '../../app/theme.js'
import { formatHours } from '../../lib/format.js'

// What a pending entry says beyond its hours and flags, shared by the Timesheets queue (ApprovalRow) and the milestone
// panel's Approvals tab (EntryCueChips), so both show the same cues from the same fields.

export const OVERTIME = 'Overtime'
export const EDITED = 'Edited'

/** Overtime asked for (the week went over 40h): its status line is "Pending (Overtime requested from …)". */
export const isOvertime = (item) => Boolean(item.entry.over_40)
/** Changed since a manager decided it. */
export const isEdited = (item) => Boolean(item.entry.edited_after_decision)
/** Already sent to HR and changed since. */
export const isHrChanged = (item) => Boolean(item.entry.changed_after_hr_submission)
/** The tone of the item's status line (`item.label`): on hold for overtime, else pending. */
export const labelTone = (item) => (isOvertime(item) ? STATUS.on_hold : STATUS.pending)
/** The person's hours logged that week, on every project: "34h this week". */
export const weekTotalText = (item) => `${formatHours(item.week_logged_total)} this week`
