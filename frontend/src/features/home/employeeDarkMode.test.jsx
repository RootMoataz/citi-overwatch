import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setPrefersDark } from '../../test/setup.js'
import MyWeekPage from './MyWeekPage.jsx'
import TimesheetPage from '../timesheet/TimesheetPage.jsx'
import PersonProfilePage from '../people/PersonProfilePage.jsx'

// The employee's three screens under a dark colour scheme: each draws its heading and first card without a console error.
const WEEK = '2026-10-12'
const apollo = { id: 'p1', name: 'Apollo Data Migration', status: 'active', is_archived: false }
const ms = (id, name, o = {}) => ({
  id, name, status: 'in_progress', display_status: 'in_progress', difficulty: 'medium', priority: 'high',
  start_date: '2026-10-01', end_date: '2026-11-30', waiting_on: [], progress_percent: 40, is_archived: false,
  role: 'primary', project: apollo, can_open: true, logged_hours: 6, approved_hours: 2, ...o,
})
const profile = {
  user: { id: users.employee.id, name: 'Eli Employee', first_name: 'Eli', last_name: 'Employee', role: 'employee',
    job_title: 'Software Engineer', department: { id: 'd1', name: 'Technology' }, is_archived: false, manager: null },
  this_week: { week_start: WEEK, logged: 12, overtime: 0, planned: 30 },
  all_time: { logged: 100, approved: 90 }, skills: [], can_edit_skills: false, coming_up: [],
  projects: [{ id: 'p1', name: 'Apollo Data Migration', status: 'active', start_date: '2026-01-01', predicted_end_date: '2026-12-31',
    is_archived: false, planned_hours_per_week: 30, on_team: true, logged_hours: 34, approved_hours: 24, can_open: true }],
  milestones: [ms('m1', 'Schema Mapping'), ms('m2', 'Hypercare', { status: 'not_started', display_status: 'not_started', progress_percent: null })],
}
const rows = [{ milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: apollo, open: true }]
const entry = { id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: '2026-10-13', hours: 6, status: 'pending', over_40: false,
  edited_after_decision: false, rejection_reason: null, note: 'Mapped tables', tracked_hours: 0, label: 'Pending approval' }

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
  setPrefersDark(true)
  server.use(
    http.get(`${API}/users/${users.employee.id}/profile`, () => HttpResponse.json(profile)),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK, user: { id: users.employee.id, name: 'Eli Employee' },
      rows, entries: [entry], totals: { logged: 6, approved: 0 } })),
    http.get(`${API}/time-entries/calendar`, ({ request }) => HttpResponse.json({ month: new URL(request.url).searchParams.get('month'),
      range: { start: '2026-09-28', end: '2026-11-01' }, user: { id: users.employee.id, name: 'Eli Employee' },
      milestones: [], entries: [entry], drafts: [], locks: [] })),
    http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [], can_group: false })),
    http.get(`${API}/milestones/:id/discussion`, () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })),
  )
})
afterEach(() => vi.useRealTimers())

const drawn = async (h1, h2) => {
  expect(await screen.findByRole('heading', { level: 1, name: h1 })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { level: 2, name: h2 })).toBeInTheDocument()
}

describe('the employee screens in dark mode', () => {
  test('My week', async () => {
    const errors = vi.spyOn(console, 'error')
    renderAsUser(<MyWeekPage />, { user: users.employee })
    await drawn('My week', 'Your focus')
    expect(errors).not.toHaveBeenCalled()
  })

  test.each([['week', /^Oct 12\D+18, 2026$/], ['month', /October 2026/]])('My timesheet, %s view', async (view, h2) => {
    localStorage.setItem('overwatch.timesheet.view', view)
    const errors = vi.spyOn(console, 'error')
    renderAsUser(<TimesheetPage />, { user: users.employee, route: view === 'month' ? '/timesheet?month=2026-10' : `/timesheet?week=${WEEK}`, path: '/timesheet' })
    await drawn('My timesheet', h2)
    if (view === 'week') expect(await screen.findByRole('columnheader', { name: /Counted/ })).toBeInTheDocument()
    else expect(await screen.findByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
  })

  test('My history', async () => {
    const errors = vi.spyOn(console, 'error')
    renderAsUser(<PersonProfilePage />, { user: users.employee, route: `/people/${users.employee.id}/profile`, path: '/people/:id/profile' })
    await drawn('My history', 'Eli Employee')
    expect(await screen.findByRole('tab', { name: /^Projects/ })).toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
  })
})
