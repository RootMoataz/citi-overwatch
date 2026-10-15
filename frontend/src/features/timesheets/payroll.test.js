import { describe, expect, test } from 'vitest'
import { BOM } from '../../lib/csv.js'
import { payrollCsv, payrollRows } from './payroll.js'

const ada = { id: 'u-ada', name: 'Ada Lovelace', username: 'ada.l' }
const bo = { id: 'u-bo', name: '=HYPERLINK("x")', username: 'bo.p' }
const submission = { id: 's2', period_start: '2026-10-12', period_end: '2026-10-18' }
const first = { id: 's1', period_start: '2026-10-05', period_end: '2026-10-11' }
const entries = [
  { id: 'e1', user: ada, hours: '8.00', cost: '400.00', is_correction: false, previous_hours: null, corrects: null },
  { id: 'e2', user: ada, hours: '7.50', cost: '375.00', is_correction: false, previous_hours: null, corrects: null },
  { id: 'e3', user: ada, hours: '6.00', cost: '300.00', is_correction: true, previous_hours: '8.00', corrects: first },
  { id: 'e4', user: bo, hours: '0.00', cost: '0.00', is_correction: true, previous_hours: '4.00', corrects: first },
]

describe('payroll CSV', () => {
  test('one row per person per type, corrections apart, with the hours sent before', () => {
    expect(payrollRows({ submission, entries })).toEqual([
      expect.objectContaining({ person: 'Ada Lovelace', employeeId: 'u-ada', username: 'ada.l', type: 'Regular', hours: 15.5,
        cost: 775, previousHours: null, entries: 2, periodStart: '2026-10-12', periodEnd: '2026-10-18', corrects: '' }),
      expect.objectContaining({ person: 'Ada Lovelace', type: 'Correction', hours: 6, cost: 300, previousHours: 8,
        corrects: '2026-10-05 to 2026-10-11' }),
      expect.objectContaining({ person: '=HYPERLINK("x")', type: 'Correction', hours: 0, cost: 0, previousHours: 4 }),
    ])
  })

  test('the file has a header, is named for the period and is safe from formula injection', () => {
    const { filename, csv } = payrollCsv({ submission, entries })
    expect(filename).toMatch(/^scout-payroll-2026-10-12-to-2026-10-18-\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = csv.replace(BOM, '').trim().split('\r\n')
    expect(lines[0]).toBe('Person,Employee ID,Username,Period start,Period end,Type,Hours,Previously submitted hours,Cost,'
      + 'Entries,Corrects submission for')
    expect(lines[1]).toBe('Ada Lovelace,u-ada,ada.l,2026-10-12,2026-10-18,Regular,15.5,,775,2,')
    expect(lines[3].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true)
  })
})
