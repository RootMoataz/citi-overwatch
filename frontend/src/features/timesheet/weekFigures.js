/** The week's hours in four words. `counted` is the live total (typed hours included); `approved` is saved approved hours
 * not being edited; `needsRevision` is saved rejected hours whose cell holds no typed hours; typed hours count as pending. */
export function weekFigures({ entries, changed, isDraft, total }) {
  const saved = Object.entries(entries ?? {})
  const edited = new Set(changed)
  const sum = (list) => list.reduce((s, [, entry]) => s + Number(entry.hours ?? 0), 0)
  const approved = sum(saved.filter(([k, entry]) => entry.status === 'approved' && !edited.has(k)))
  const needsRevision = sum(saved.filter(([k, entry]) => entry.status === 'rejected' && !isDraft(k)))
  return { counted: total, approved, pending: total - approved, needsRevision, entered: total + needsRevision }
}
