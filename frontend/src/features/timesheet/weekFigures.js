/**
 * The Week totals card's figures, from the same cells the grid counts (the shown week's listed rows).
 * cells: one per grid cell, as useTimesheetWeek hands them over: `hours`, what the cell adds to the week (0 when it
 * doesn't count); `counts`, whether it counts (typed on a cell Submit can send, a timer draft, or saved and not
 * rejected); `entry`, its saved entry, if any; `edited`, it holds an unsaved change.
 * unlisted: this week's saved entries on rows the sheet no longer lists (unassigned since). The server still counts
 * their pending and approved hours toward the week and the 40h rule, so they count here too; `unlisted` is their sum.
 * `approved` is saved approved hours not being changed; `pending` is everything else that counts, so it is never
 * negative; `needsRevision` is saved rejected hours on a cell that doesn't count (nothing typed over them).
 */
export function weekFigures(cells, unlisted = []) {
  let counted = 0
  let approved = 0
  let needsRevision = 0
  let away = 0
  for (const { hours, counts, entry, edited } of cells) {
    counted += hours
    if (counts && !edited && entry?.status === 'approved') approved += hours
    if (!counts && entry?.status === 'rejected') needsRevision += Number(entry.hours ?? 0)
  }
  for (const entry of unlisted) {
    if (entry.status === 'rejected') continue
    const hours = Number(entry.hours ?? 0)
    away += hours
    counted += hours
    if (entry.status === 'approved') approved += hours
  }
  return { counted, approved, pending: Math.max(counted - approved, 0), needsRevision, entered: counted + needsRevision, unlisted: away }
}
