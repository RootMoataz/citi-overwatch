// Shared fixtures for the Month calendar's tests: the calendar route, its milestones, entries and timer locks, and
// MonthView rendered with ?day= kept in state the way the page keeps it in the URL.
import { screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'
import MonthView from '../features/timesheet/MonthView.jsx'
import { renderAsUser, users } from './render.jsx'
import { API, HttpResponse, http, server } from './server.js'
import { setViewport } from './setup.js'

export const RANGES = {
  '2026-09': { start: '2026-08-31', end: '2026-10-04' },
  '2026-10': { start: '2026-09-28', end: '2026-11-01' },
  '2026-11': { start: '2026-10-26', end: '2026-12-06' },
}
// Milestones end after the grid unless a test gives them a deadline in it.
export const milestone = (id, name, overrides) => ({ id, name, start_date: '2026-10-01', end_date: '2026-12-18', status: 'in_progress',
  display_status: 'in_progress', progress_percent: 40, project: { id: 'p1', name: 'Apollo Data Migration', status: 'active' },
  role: 'primary', ...overrides })
export const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: '2026-10-14', hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', tracked_hours: 0, label: 'Pending approval', ...overrides })
export const lock = (overrides) => ({ milestone_id: 'm1', work_date: '2026-10-14', hours: 4, draft_hours: 0, tracked_hours: 4, request: null,
  ...overrides })
export const m1 = milestone('m1', 'Schema Mapping')
export const m2 = milestone('m2', 'Build', { project: { id: 'p2', name: 'Zephyr Portal', status: 'active' } })
export const m3 = milestone('m3', 'Cutover')
export const m4 = milestone('m4', 'Hypercare')

export const mixedDay = {
  entries: [entry({ id: 'a', milestone_id: 'm1', hours: 6, status: 'approved' }), entry({ id: 'b', milestone_id: 'm2', hours: 2 }),
    entry({ id: 'c', milestone_id: 'm3', hours: 3, status: 'rejected', rejection_reason: 'Wrong milestone' })],
  drafts: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 1.5 }],
  locks: [lock({ hours: 7.5, draft_hours: 1.5, tracked_hours: 0 })],
}

export function calendar({ milestones = [m1, m2, m3], entries = [], drafts = [], locks = [] } = {}) {
  return http.get(`${API}/time-entries/calendar`, ({ request }) => {
    const month = new URL(request.url).searchParams.get('month')
    return HttpResponse.json({ month, range: RANGES[month], user: { id: users.employee.id, name: 'Eli Employee' },
      milestones, entries, drafts, locks })
  })
}

export const calls = { onMonthChange: vi.fn(), onSelectDay: vi.fn(), onOpenDay: vi.fn(), onRequest: vi.fn() }

// The page keeps ?day=; this harness keeps it in state the same way.
function Harness({ month, day: first }) {
  const [day, setDay] = useState(first)
  return <MonthView month={month} day={day} onMonthChange={calls.onMonthChange} onOpenDay={calls.onOpenDay} onRequest={calls.onRequest}
    onSelectDay={(iso) => { calls.onSelectDay(iso); setDay(iso) }} />
}
export const renderMonth = (month = '2026-10', day = undefined) =>
  renderAsUser(<Harness month={month} day={day} />, { user: users.employee, route: '/timesheet' })

export const dayBox = (name) => screen.findByRole('button', { name })
export const panel = (name) => screen.findByRole('region', { name })
export const chips = (box) => box.querySelectorAll('[data-line]')
export const cardOf = (region, name) => within(region).getByRole('heading', { name }).closest('li')

/** "Today" is Wednesday 14 Oct 2026; only Date is faked, so requests run normally. */
export function setUpMonthTests() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0))
    for (const fn of Object.values(calls)) fn.mockClear()
    server.use(calendar())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    setViewport(1280)
  })
}
