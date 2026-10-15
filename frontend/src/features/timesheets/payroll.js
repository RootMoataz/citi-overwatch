// The payroll CSV for one HR submission, built in the browser from GET /hr-submissions/{id}/entries.
// One line per person per type: their regular hours for the period, and (on a re-submission) their corrections to
// hours sent earlier. Cells go through lib/csv.js, so names can't run as spreadsheet formulas.
import { csvFilename, num, toCsv } from '../../lib/csv.js'

const cents = (value) => Math.round(value * 100) / 100
const period = (p) => (p ? `${p.period_start} to ${p.period_end}` : '')

/** Entries → one row per (person, Regular/Correction), people in the order the server sent them. */
export function payrollRows({ submission, entries }) {
  const rows = new Map()
  for (const e of entries) {
    const type = e.is_correction ? 'Correction' : 'Regular'
    const key = `${e.user.id}|${type}`
    if (!rows.has(key)) {
      rows.set(key, { person: e.user.name, employeeId: e.user.id, username: e.user.username, type, hours: 0, cost: 0,
        previousHours: e.is_correction ? 0 : null, corrects: new Set(), entries: 0 })
    }
    const row = rows.get(key)
    row.hours = cents(row.hours + num(e.hours))
    row.cost = cents(row.cost + num(e.cost))
    row.entries += 1
    if (e.is_correction) {
      row.previousHours = cents(row.previousHours + num(e.previous_hours ?? 0))
      if (e.corrects) row.corrects.add(period(e.corrects))
    }
  }
  return [...rows.values()].map((r) => ({ ...r, periodStart: submission.period_start, periodEnd: submission.period_end,
    corrects: [...r.corrects].join('; ') }))
}

export const PAYROLL_COLUMNS = [
  { header: 'Person', value: (r) => r.person },
  { header: 'Employee ID', value: (r) => r.employeeId },
  { header: 'Username', value: (r) => r.username },
  { header: 'Period start', value: (r) => r.periodStart },
  { header: 'Period end', value: (r) => r.periodEnd },
  { header: 'Type', value: (r) => r.type },
  { header: 'Hours', value: (r) => r.hours },
  { header: 'Previously submitted hours', value: (r) => r.previousHours },
  { header: 'Cost', value: (r) => r.cost },
  { header: 'Entries', value: (r) => r.entries },
  { header: 'Corrects submission for', value: (r) => r.corrects },
]

/** The whole file and its name, e.g. scout-payroll-2026-10-05-to-2026-10-11-2026-10-15.csv. */
export function payrollCsv(data) {
  const { submission } = data
  return {
    filename: csvFilename(`payroll-${submission.period_start}-to-${submission.period_end}`),
    csv: toCsv(PAYROLL_COLUMNS, payrollRows(data)),
  }
}
