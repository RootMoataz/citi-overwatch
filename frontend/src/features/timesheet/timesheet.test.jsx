import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Layout from '../../app/Layout.jsx'
import NotificationBell from '../../components/NotificationBell.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../../test/render.jsx'
import TimesheetsPage from '../timesheets/TimesheetsPage.jsx'
import BreakdownPanel from '../approvals/BreakdownPanel.jsx'
import { useLoggable } from '../timer/useLoggable.js'
import { setViewport } from '../../test/setup.js'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const rows = [
  { milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' } },
  { milestone: { id: 'm2', name: 'Build' }, project: { id: 'p2', name: 'Atlas' } },
]
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: WEEK, hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', label: 'Pending approval', ...overrides })

function weekHandler(entries = [], seen = {}) {
  return http.get(`${API}/time-entries`, ({ request }) => {
    seen.week = new URL(request.url).searchParams.get('week')
    return HttpResponse.json({ week_start: WEEK, user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries,
      totals: { logged: entries.reduce((s, e) => s + (e.status === 'rejected' ? 0 : e.hours), 0), approved: 0 } })
  })
}

const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />, { user: users.employee, route, path: '/timesheet' })

describe('TimesheetPage', () => {
  // These tests drive the week grid; the day view has its own in dayView.test.jsx.
  beforeEach(() => { localStorage.setItem('overwatch.timesheet.view', 'week') })

  test("timesheet rows are the employee's assigned milestones", async () => {
    const seen = {}
    server.use(weekHandler([], seen))
    renderSheet()
    expect(await screen.findByRole('rowheader', { name: /schema mapping/i })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /build/i })).toBeInTheDocument()
    expect(screen.getByText('Apollo')).toBeInTheDocument()
    expect(seen.week).toBe(WEEK)
  })

  test('totals update as you type and save sends one PUT', async () => {
    let puts = 0
    let body = null
    server.use(weekHandler([entry()]), http.put(`${API}/time-entries`, async ({ request }) => {
      puts += 1
      body = await request.json()
      return HttpResponse.json({ week_start: WEEK, rows, entries: [entry(), entry({ id: 'e2', work_date: '2026-10-13', hours: 9 })],
        totals: { logged: 17, approved: 0 }, user: { id: users.employee.id, name: 'Eli Employee' } })
    }))
    renderSheet()
    const user = userEvent.setup()
    const tue = await screen.findByLabelText('Schema Mapping, Tue Oct 13')
    expect(screen.getByTestId('week-total')).toHaveTextContent('8h counted of 40h')
    await user.type(tue, '9')
    expect(screen.getByTestId('week-total')).toHaveTextContent('17h counted of 40h')
    await user.type(screen.getByLabelText('Build, Wed Oct 14'), '30')
    expect(screen.getByTestId('week-total')).toHaveTextContent('47h counted of 40h')
    expect(await screen.findByText('More than 24h on Wed Oct 14')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Build, Wed Oct 14'))
    await user.click(screen.getByRole('button', { name: /^submit/i }))
    await waitFor(() => expect(puts).toBe(1))
    expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: '2026-10-13', hours: 9 }] })
  })

  test.each([
    ['-', ''], ['+', ''], ['e', ''], ['1e1', '11'], ['7.255', '7.25'], ['7.5.', '7.5'], ['123', '12'], ['7.25', '7.25'],
  ])('typing %j into an hours cell leaves %j', async (typed, shown) => {
    server.use(weekHandler())
    renderSheet()
    const user = userEvent.setup()
    const cell = await screen.findByLabelText('Build, Mon Oct 12')
    await user.type(cell, typed)
    expect(cell).toHaveValue(shown)
  })

  test.each([['-3', ''], ['abc', ''], ['1e1', ''], ['+5', ''], ['7.5h', ''], ['7.255', ''], ['7.5', '7.5'], [' 8 ', '8']])(
    'pasting %j into an empty hours cell leaves %j (junk is refused whole, never half-cleaned)', async (pasted, shown) => {
      server.use(weekHandler())
      renderSheet()
      const user = userEvent.setup()
      const cell = await screen.findByLabelText('Build, Mon Oct 12')
      await user.click(cell)
      await user.paste(pasted)
      expect(cell).toHaveValue(shown)
    })

  test.each(['-', '+', 'e', 'E', ',', 'x'])('the %j key is blocked outright', async (key) => {
    server.use(weekHandler())
    renderSheet()
    const user = userEvent.setup()
    const cell = await screen.findByLabelText('Build, Mon Oct 12')
    await user.type(cell, `7${key}5`)
    expect(cell).toHaveValue('75')
  })

  test('a valid two-decimal value saves as a number, and under 0.25 is flagged', async () => {
    let body = null
    server.use(weekHandler(), http.put(`${API}/time-entries`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ week_start: WEEK, rows, entries: [], totals: { logged: 7.25, approved: 0 },
        user: { id: users.employee.id, name: 'Eli Employee' } })
    }))
    renderSheet()
    const user = userEvent.setup()
    const tue = await screen.findByLabelText('Build, Tue Oct 13')
    await user.type(tue, '0.1')
    expect(tue).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/at least 0.25 hours/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^submit/i })).toBeDisabled()
    await user.clear(tue)
    const cell = screen.getByLabelText('Build, Mon Oct 12')
    await user.type(cell, '7.25')
    expect(cell).toHaveAttribute('inputmode', 'decimal')
    expect(cell).toHaveAttribute('aria-invalid', 'false')
    await user.click(screen.getByRole('button', { name: /^submit/i }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm2', work_date: WEEK, hours: 7.25 }] }))
  })

  // "cells show the status words, Edited tag and rejection reason" and "a rejected cell can be resubmitted with the same
  // hours" moved to Entry details (entryPanel.test.jsx): Edited, Overtime and the reason are in the panel, and its
  // Save & resubmit sends the cell's same hours.

  test('a supporting row shows a Supporting chip', async () => {
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
      user: { id: users.employee.id, name: 'Eli Employee' }, rows: [rows[0], { ...rows[1], role: 'supporting' }], entries: [],
      totals: { logged: 0, approved: 0 } })))
    renderSheet()
    const build = await screen.findByRole('rowheader', { name: /build/i })
    expect(within(build).getByText('Supporting')).toBeInTheDocument()
    expect(within(screen.getByRole('rowheader', { name: /schema mapping/i })).queryByText('Supporting')).not.toBeInTheDocument()
  })

  test('a note added through the note popover is saved with the hours', async () => {
    let body = null
    server.use(weekHandler(), http.put(`${API}/time-entries`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ week_start: WEEK, rows, entries: [], totals: { logged: 6, approved: 0 },
        user: { id: users.employee.id, name: 'Eli Employee' } })
    }))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Mon Oct 12'), '6')
    // A new cell with hours and no note: its note icon asks for attention before saving.
    const noteButton = screen.getByRole('button', { name: 'Add work note, Build, Mon Oct 12' })
    expect(noteButton).toHaveAttribute('data-attention', 'true')
    await user.click(noteButton)
    const field = await screen.findByLabelText(/what did you work on/i)
    await user.type(field, 'too short')
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    await user.type(field, ' no more: wired the settings form')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Edit work note, Build, Mon Oct 12' })).not.toHaveAttribute('data-attention')
    await user.click(screen.getByRole('button', { name: /^submit/i }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm2', work_date: WEEK, hours: 6,
      note: 'too short no more: wired the settings form' }] }))
  })

  test('a note alone changes an existing entry', async () => {
    let body = null
    server.use(weekHandler([entry({ needs_note: true, source: 'tracked', tracked_hours: 8 })]),
      http.put(`${API}/time-entries`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ week_start: WEEK, rows, entries: [], totals: { logged: 8, approved: 0 },
          user: { id: users.employee.id, name: 'Eli Employee' } })
      }))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByText('Add a note')).toBeInTheDocument()
    // Where the hours came from is in Entry details now, opened from the cell's status line.
    await user.click(screen.getByRole('button', { name: 'Pending, details for Schema Mapping, Mon Oct 12' }))
    expect(within(await screen.findByRole('complementary', { name: 'Entry details' })).getByLabelText('Source')).toHaveValue('Tracked')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Add work note, Schema Mapping, Mon Oct 12' }))
    await user.type(await screen.findByLabelText(/what did you work on/i), 'Mapped the address tables')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Add a note')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^submit/i }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WEEK, hours: 8,
      note: 'Mapped the address tables' }] }))
  })

  // "cells say where their hours came from" moved to Entry details (entryPanel.test.jsx): its Source reads Manual, Tracked
  // or Mixed, and the grid keeps the note button.

  test('a save refused for missing proof lists the cells that need a note', async () => {
    server.use(weekHandler(), http.put(`${API}/time-entries`, () => HttpResponse.json({ error: {
      code: 'PROOF_REQUIRED', message: 'Add a work note (10-500 characters) or post a progress update that day for: ...',
      details: { cells: [
        { milestone_id: 'm2', milestone: 'Build', work_date: WEEK, reason: 'no_note' },
        { milestone_id: 'm1', milestone: 'Schema Mapping', work_date: '2026-10-13', reason: 'note_too_short' }] },
      request_id: 'r1' } }, { status: 400 })))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Mon Oct 12'), '6')
    await user.type(screen.getByLabelText('Schema Mapping, Tue Oct 13'), '2')
    await user.click(screen.getByRole('button', { name: /^submit/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Add a work note before saving')
    expect(within(alert).getByText('Build, Mon Oct 12')).toBeInTheDocument()
    expect(within(alert).getByText('Schema Mapping, Tue Oct 13 (note too short)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add work note, Build, Mon Oct 12' })).toHaveAttribute('data-attention', 'true')
  })

  test('timer buttons sit on the rows of the current week only', async () => {
    server.use(weekHandler())
    renderAsUser(<TimesheetPage />, { user: users.employee, route: '/timesheet', path: '/timesheet' })
    expect(await screen.findByRole('button', { name: 'Start timer on Schema Mapping' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start timer on Build' })).toBeInTheDocument()
    // The compact button the grid has always had: My week's 44 px target doesn't change it here.
    expect(screen.getByRole('button', { name: 'Start timer on Build' })).not.toHaveStyle({ minHeight: '44px' })
  })

  test('a completed milestone has no timer button', async () => {
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK, user: { id: users.employee.id, name: 'Eli Employee' },
      entries: [], totals: { logged: 0, approved: 0 },
      rows: [{ milestone: { id: 'm1', name: 'Schema Mapping', status: 'completed' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
        { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project: { id: 'p2', name: 'Atlas', status: 'active' }, open: true }] })))
    renderAsUser(<TimesheetPage />, { user: users.employee, route: '/timesheet', path: '/timesheet' })
    expect(await screen.findByRole('button', { name: 'Start timer on Build' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start timer on Schema Mapping' })).not.toBeInTheDocument()
  })

  test('past weeks have no timer buttons', async () => {
    server.use(weekHandler())
    renderAsUser(<TimesheetPage />, { user: users.employee, route: '/timesheet?week=2026-09-28', path: '/timesheet' })
    expect(await screen.findByRole('rowheader', { name: /schema mapping/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start timer/i })).not.toBeInTheDocument()
  })

  test('changing week updates the URL', async () => {
    server.use(weekHandler())
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /previous week/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('week=2026-10-05')
  })
})

const pending = {
  entry: entry({ id: 'e9', hours: 9, label: 'Pending (Overtime requested from Eli Employee)', over_40: true }),
  label: 'Pending (Overtime requested from Eli Employee)', user: { id: users.employee.id, name: 'Eli Employee' },
  milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' }, week_logged_total: 45,
}

describe('Timesheets To review', () => {
  test('reject requires a reason', async () => {
    let body = null
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([pending])),
      http.post(`${API}/time-entries/e9/reject`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    renderAsUser(<TimesheetsPage />, { user: users.manager, route: '/timesheets', path: '/timesheets' })
    const user = userEvent.setup()
    expect(await screen.findByText('Pending (Overtime requested from Eli Employee)')).toBeInTheDocument()
    expect(screen.getByText('45h this week')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^reject/i }))
    const dialog = await screen.findByRole('dialog', { name: /reject these hours/i })
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    expect(await within(dialog).findByText('Tell the employee why')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/reason/i), 'Wrong milestone')
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(body).toEqual({ reason: 'Wrong milestone', expected_hours: 9 }))
  })

  test('approve removes the row', async () => {
    let list = [pending]
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json(list)),
      http.post(`${API}/time-entries/e9/approve`, () => { list = []; return HttpResponse.json({}) }))
    renderAsUser(<TimesheetsPage />, { user: users.manager, route: '/timesheets', path: '/timesheets' })
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument()
  })
})

describe('Timesheets To review decisions', () => {
  test('approve sends the hours the manager saw', async () => {
    let body = null
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([pending])),
      http.post(`${API}/time-entries/e9/approve`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    renderAsUser(<TimesheetsPage />, { user: users.manager, route: '/timesheets', path: '/timesheets' })
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(body).toEqual({ expected_hours: 9 }))
  })

  test('a stale entry shows why and reloads the queue', async () => {
    let gets = 0
    server.use(http.get(`${API}/approvals`, () => { gets += 1; return HttpResponse.json([pending]) }),
      http.post(`${API}/time-entries/e9/approve`, () => HttpResponse.json({ error: { code: 'STALE_ENTRY',
        message: 'These hours changed since you loaded them. Refresh and check again.', request_id: 'r1' } }, { status: 409 })))
    renderAsUser(<TimesheetsPage />, { user: users.manager, route: '/timesheets', path: '/timesheets' })
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText(/hours changed since you loaded them/i)).toBeInTheDocument()
    await waitFor(() => expect(gets).toBeGreaterThan(1))
  })
})

describe('BreakdownPanel', () => {
  test('breakdown panel shows before/after remaining and forecast warning', async () => {
    server.use(http.get(`${API}/time-entries/e9/breakdown`, () => HttpResponse.json({
      entry_id: 'e9', hours: 9, hourly_rate: 50, request_cost: 450, milestone_cost: 1600, milestone_cost_after: 2050,
      budget: 10000, consumed: 9800, remaining: 200, remaining_before: 200, remaining_after: -250, pct_of_remaining: 225,
      forecast: 12500, forecast_over_budget: true, weeks_remaining: 6 })))
    renderWithProviders(<BreakdownPanel entryId="e9" />)
    expect(await screen.findByText('$450.00')).toBeInTheDocument()
    expect(screen.getByText(/\$200\.00 → -\$250\.00/)).toBeInTheDocument()
    expect(screen.getByText('225%')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/projected to go over budget/i)
    expect(screen.getByText(/\$12,500\.00/)).toBeInTheDocument()
  })
})

describe('BreakdownPanel for a manager', () => {
  test('without an hourly rate it shows the cost and the hours only', async () => {
    server.use(http.get(`${API}/time-entries/e9/breakdown`, () => HttpResponse.json({
      entry_id: 'e9', hours: 9, request_cost: 450, milestone_cost: 1600, milestone_cost_after: 2050,
      budget: 10000, consumed: 1600, remaining: 8400, remaining_before: 8400, remaining_after: 7950, pct_of_remaining: 5.4,
      forecast: 5000, forecast_over_budget: false, weeks_remaining: 6 })))
    renderWithProviders(<BreakdownPanel entryId="e9" />)
    expect(await screen.findByText('$450.00')).toBeInTheDocument()
    expect(screen.getByText('9h logged')).toBeInTheDocument()
    expect(screen.queryByText(/\/h/)).not.toBeInTheDocument()
  })
})

describe('NotificationBell', () => {
  test('notification bell shows unread count and marks read on click', async () => {
    let read = null
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json(read ? [] : [{ id: 'n1', type: 'OVER_40H', week_start: WEEK,
        read_at: null, subject_user: { id: users.employee.id, name: 'Eli Employee' },
        message: 'Eli Employee passed 40h for the week of 2026-10-12' }])),
      http.post(`${API}/notifications/n1/read`, () => { read = 'n1'; return HttpResponse.json({ id: 'n1', read: true }) }),
    )
    renderAsUser(<NotificationBell />, { user: users.manager, route: '/', path: '/' })
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' })
    await userEvent.click(bell)
    await userEvent.click(await screen.findByRole('menuitem', { name: /eli employee passed 40h/i }))
    // The bell navigates only once the read is answered: wait for the landing, not just for the server to see the read.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/timesheets?user=${users.employee.id}`))
    expect(read).toBe('n1')
  })

  test('a rejection alert opens the timesheet for that week', async () => {
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n2', type: 'ENTRY_REJECTED', week_start: WEEK,
        read_at: null, subject_user: { id: users.employee.id, name: 'Eli Employee' },
        payload: { work_date: WEEK, hours: 8, reason: 'Wrong milestone', milestone: { id: 'm1', name: 'Schema Mapping' },
          project: { id: 'p1', name: 'Apollo' } },
        message: 'Your 8h on Schema Mapping (Mon 12 Oct) was rejected: Wrong milestone' }])),
      http.post(`${API}/notifications/n2/read`, () => HttpResponse.json({ id: 'n2', read: true })),
    )
    renderAsUser(<NotificationBell />, { user: users.employee, route: '/', path: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const item = await screen.findByRole('menuitem', { name: /your 8h on schema mapping .* was rejected: wrong milestone/i })
    expect(within(item).getByText(/open your timesheet/i)).toBeInTheDocument()
    await userEvent.click(item)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/timesheet?week=${WEEK}`))
  })

  test('a support alert opens the project milestones', async () => {
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n3', type: 'SUPPORT_ASSIGNED', week_start: null,
        read_at: null, subject_user: { id: users.employee.id, name: 'Eli Employee' },
        payload: { milestone: { id: 'm2', name: 'Build' }, project: { id: 'p2', name: 'Atlas' }, end_date: '2026-10-30' },
        message: "You've been added as support on Build (Atlas), due Fri 30 Oct" }])),
      http.post(`${API}/notifications/n3/read`, () => HttpResponse.json({ id: 'n3', read: true })),
    )
    renderAsUser(<NotificationBell />, { user: users.employee, route: '/', path: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /added as support on build/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/p2?tab=milestones'))
  })

  test('a claimed-milestone alert opens the project milestones', async () => {
    server.use(
      http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n4', type: 'MILESTONE_CLAIMED', week_start: null,
        read_at: null, subject_user: { id: 'u-ada', name: 'Ada Lovelace' },
        payload: { milestone: { id: 'm5', name: 'Design' }, project: { id: 'p3', name: 'Beacon' } },
        message: 'Ada Lovelace claimed Design (Beacon)' }])),
      http.post(`${API}/notifications/n4/read`, () => HttpResponse.json({ id: 'n4', read: true })),
    )
    renderAsUser(<NotificationBell />, { user: users.manager, route: '/', path: '/' })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    const item = await screen.findByRole('menuitem', { name: /ada lovelace claimed design/i })
    expect(within(item).getByText(/open the project's milestones/i)).toBeInTheDocument()
    await userEvent.click(item)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/p3?tab=milestones'))
  })
})

test('employee does not see Timesheets in navigation', () => {
  renderWithProviders(<Routes><Route path="*" element={<Layout user={users.employee} />} /></Routes>)
  expect(screen.getByRole('navigation', { name: /main/i })).not.toHaveTextContent('Timesheets')
})

// The mockup's week: Mon 0.25, Tue 7.75 and Fri 7.75 approved; Thu 4 pending; Wed 8 rejected.
const mockRows = [{ milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
  { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true }]
const mockEntries = [
  entry({ id: 'a', work_date: '2026-10-12', hours: 0.25, status: 'approved' }),
  entry({ id: 'b', work_date: '2026-10-13', hours: 7.75, status: 'approved' }),
  entry({ id: 'c', work_date: '2026-10-14', hours: 8, status: 'rejected', rejection_reason: 'Wrong milestone' }),
  entry({ id: 'd', work_date: '2026-10-15', hours: 4, status: 'pending' }),
  entry({ id: 'f', work_date: '2026-10-16', hours: 7.75, status: 'approved' }),
]
const mockWeek = (entries = mockEntries, seen = []) => http.get(`${API}/time-entries`, ({ request }) => {
  seen.push(new URL(request.url).searchParams.get('week'))
  return HttpResponse.json({ week_start: WEEK, user: { id: users.employee.id, name: 'Eli Employee' }, rows: mockRows, entries,
    totals: { logged: 19.75, approved: 15.75 } })
})
const emptyCalendar = () => http.get(`${API}/time-entries/calendar`, ({ request }) => HttpResponse.json({
  month: new URL(request.url).searchParams.get('month'), range: { start: '2026-09-28', end: '2026-11-01' },
  user: { id: users.employee.id, name: 'Eli Employee' }, milestones: [], entries: [], drafts: [], locks: [] }))
function Loggable() { return <p>{useLoggable().size} loggable</p> }

describe('My timesheet header, totals and week bar', () => {
  beforeEach(() => {
    localStorage.setItem('overwatch.timesheet.view', 'week')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
  })
  afterEach(() => {
    server.events.removeAllListeners()
    vi.useRealTimers()
  })

  test('the header has the new subtitle, Submit starts disabled and nothing says saved', async () => {
    server.use(mockWeek())
    renderSheet()
    expect(await screen.findByRole('heading', { level: 1, name: 'My timesheet' })).toBeInTheDocument()
    expect(screen.getByText('Review your week. Submit with confidence.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument()
  })

  test('the Week totals card holds counted, percent, the three figures and the note', async () => {
    server.use(mockWeek())
    renderSheet()
    const card = await screen.findByRole('group', { name: 'Week totals' })
    expect(await within(card).findByText('19.75h counted of 40h')).toBe(screen.getByTestId('week-total'))
    expect(within(card).getByText('49%')).toBeInTheDocument()
    expect(within(card).getByRole('progressbar', { name: 'Counted hours against 40h' })).toHaveAttribute('aria-valuetext', '19.75h of 40h')
    for (const [hours, word] of [['15.75h', 'Approved'], ['4h', 'Pending'], ['8h', 'Needs revision']]) {
      expect(within(card).getByText(hours)).toBeInTheDocument()
      expect(within(card).getByText(word)).toBeInTheDocument()
    }
    expect(within(card).getByText(/Rejected hours are excluded from counted totals\./)).toBeInTheDocument()
  })

  test('typing hours counts them as pending, and past 40h the total warns', async () => {
    server.use(mockWeek())
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Sat Oct 17'), '2')
    const card = screen.getByRole('group', { name: 'Week totals' })
    expect(screen.getByTestId('week-total')).toHaveTextContent('21.75h counted of 40h')
    expect(within(card).getByText('6h')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Build, Sun Oct 18'), '20')
    expect(screen.getByTestId('week-total')).toHaveAttribute('data-over', 'true')
    expect(screen.getByText(/Hours above 40 are sent to your manager as an overtime request/)).toBeInTheDocument()
  })

  test('the footnote shows entered and excluded hours only when something is rejected', async () => {
    server.use(mockWeek())
    const first = renderSheet()
    expect(await screen.findByText(/27\.75h entered · 8h excluded until resubmitted\./)).toBeInTheDocument()
    first.unmount()
    server.use(mockWeek(mockEntries.filter((x) => x.status !== 'rejected')))
    renderSheet()
    await screen.findByLabelText('Build, Sat Oct 17')
    expect(screen.queryByText(/excluded until resubmitted/)).not.toBeInTheDocument()
  })

  test('the week bar names the week, moves between weeks and has the view toggle', async () => {
    server.use(mockWeek())
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 12 – 18, 2026' })).toBeInTheDocument()
    const toggle = screen.getByRole('group', { name: 'Timesheet view' })
    expect(within(toggle).getAllByRole('button').map((b) => b.textContent)).toEqual(['Day', 'Week', 'Month'])
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 19 – 25, 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 5 – 11, 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 12 – 18, 2026' })).toBeInTheDocument()
  })

  test('Sunday evening in New York is still the week of Oct 12, and Sunday is the open day', async () => {
    vi.setSystemTime(new Date('2026-10-19T02:00:00Z'))
    localStorage.setItem('overwatch.timesheet.view', 'day')
    const seen = []
    server.use(mockWeek(mockEntries, seen))
    renderAsUser(<><TimesheetPage /><Loggable /></>, { user: users.employee, route: '/timesheet', path: '/timesheet' })
    expect(await screen.findByRole('region', { name: 'Sunday 18 October 2026' })).toBeInTheDocument()
    expect(await screen.findByText('2 loggable')).toBeInTheDocument()
    expect(new Set(seen)).toEqual(new Set([WEEK]))
  })

  test("Month's today box is Oct 18 on a Sunday evening in New York", async () => {
    vi.setSystemTime(new Date('2026-10-19T02:00:00Z'))
    localStorage.setItem('overwatch.timesheet.view', 'month')
    server.use(mockWeek(), emptyCalendar())
    renderSheet('/timesheet')
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    const today = await screen.findByRole('button', { name: /^Sun 18 Oct, today/ })
    expect(today).toHaveAttribute('aria-pressed', 'true')
  })

  test('loading the week and switching to Month never asks for another person or for approvals', async () => {
    const urls = []
    server.events.on('request:start', ({ request }) => urls.push(new URL(request.url)))
    server.use(mockWeek(), emptyCalendar())
    renderSheet()
    await screen.findByLabelText('Build, Sat Oct 17')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((u) => u.searchParams.has('user') || u.pathname.includes('/approvals'))).toEqual([])
  })
})

describe('Week grid columns, status words and legend', () => {
  const grid = (entries) => http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
    user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries, totals: { logged: 0, approved: 0 } }))
  beforeEach(() => {
    localStorage.setItem('overwatch.timesheet.view', 'week')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  test('the headers read Milestone, weekday over date, Today and Counted', async () => {
    server.use(grid([]))
    renderSheet()
    const table = await screen.findByRole('table')
    const heads = within(table).getAllByRole('columnheader')
    expect(heads.map((h) => h.textContent)).toEqual(['Milestone', 'MonOct 12', 'TueOct 13', 'WedOct 14', 'ThuOct 15Today',
      'FriOct 16', 'SatOct 17', 'SunOct 18', 'Counted'])
    expect(within(table).getByRole('columnheader', { name: /Mon\s*Oct 12/ })).not.toHaveAttribute('data-today')
    expect(within(table).getByRole('columnheader', { name: /Thu\s*Oct 15\s*Today/ })).toHaveAttribute('data-today', 'true')
    expect(within(table).getByRole('columnheader', { name: /Sat\s*Oct 17/ })).toHaveAttribute('data-weekend', 'true')
    expect(within(table).getByRole('columnheader', { name: /Sun\s*Oct 18/ })).toHaveAttribute('data-weekend', 'true')
  })

  test('a past week has no Today column', async () => {
    server.use(grid([]))
    renderSheet('/timesheet?week=2026-10-05')
    const table = await screen.findByRole('table')
    expect(table.querySelector('[data-today]')).toBeNull()
    expect(within(table).queryByText('Today')).not.toBeInTheDocument()
  })

  test('a project row reads its name', async () => {
    server.use(grid([]))
    renderSheet()
    expect(await screen.findByRole('row', { name: 'Apollo' })).toBeInTheDocument()
  })

  test('cells use the status words, with Overtime separate, and none of the server labels', async () => {
    server.use(grid([
      entry({ id: 'e1', status: 'approved', label: 'Approved' }),
      entry({ id: 'e2', work_date: '2026-10-13', over_40: true, label: 'Pending (Overtime requested from Eli Employee)' }),
      entry({ id: 'e3', work_date: '2026-10-14', status: 'rejected', label: 'Rejected', rejection_reason: 'Wrong milestone' }),
    ]))
    renderSheet()
    const table = await screen.findByRole('table')
    const body = within(table)
    expect(await body.findByText('Pending')).toBeInTheDocument()
    expect(body.getByText('Overtime')).toBeInTheDocument()
    expect(body.getByText('Needs revision')).toBeInTheDocument()
    expect(body.getAllByText('Approved').length).toBeGreaterThan(0)
    expect(body.queryByText(/Pending approval|Rejected|Overtime requested from/)).not.toBeInTheDocument()
  })

  test('Counted leaves rejected hours out and Daily total (counted) is a row header', async () => {
    server.use(grid([
      entry({ id: 'e1', status: 'approved' }),
      entry({ id: 'e3', work_date: '2026-10-14', status: 'rejected', label: 'Rejected', rejection_reason: 'x' }),
    ]))
    renderSheet()
    const row = (await screen.findByRole('rowheader', { name: /schema mapping/i })).closest('tr')
    const cells = within(row).getAllByRole('cell')
    expect(cells[cells.length - 1]).toHaveTextContent('8h')
    expect(screen.getByRole('rowheader', { name: 'Daily total (counted)' })).toBeInTheDocument()
  })

  test('a Legend list names the three statuses', async () => {
    server.use(grid([]))
    renderSheet()
    const legend = await screen.findByRole('list', { name: 'Legend' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Approved', 'Pending', 'Needs revision'])
  })

  test('on a phone the grid is still a table and the Weekend switch shows', async () => {
    setViewport(375)
    server.use(grid([]))
    renderSheet()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Weekend' })).toBeInTheDocument()
  })
})
