import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import Layout from '../../app/Layout.jsx'
import NotificationBell from '../../components/NotificationBell.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../../test/render.jsx'
import TimesheetsPage from '../timesheets/TimesheetsPage.jsx'
import BreakdownPanel from '../approvals/BreakdownPanel.jsx'
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

const renderSheet = () => renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}`, path: '/timesheet' })

describe('TimesheetPage', () => {
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
    expect(screen.getByTestId('week-total')).toHaveTextContent('8h / 40h')
    await user.type(tue, '9')
    expect(screen.getByTestId('week-total')).toHaveTextContent('17h / 40h')
    await user.type(screen.getByLabelText('Build, Wed Oct 14'), '30')
    expect(screen.getByTestId('week-total')).toHaveTextContent('47h / 40h')
    expect(await screen.findByText('More than 24h on Wed Oct 14')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Build, Wed Oct 14'))
    await user.click(screen.getByRole('button', { name: /save week/i }))
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
    expect(screen.getByRole('button', { name: /save week/i })).toBeDisabled()
    await user.clear(tue)
    const cell = screen.getByLabelText('Build, Mon Oct 12')
    await user.type(cell, '7.25')
    expect(cell).toHaveAttribute('inputmode', 'decimal')
    expect(cell).toHaveAttribute('aria-invalid', 'false')
    await user.click(screen.getByRole('button', { name: /save week/i }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm2', work_date: WEEK, hours: 7.25 }] }))
  })

  test('cells show backend labels, Edited tag and rejection reason', async () => {
    server.use(weekHandler([
      entry({ id: 'e1', label: 'Pending (Overtime requested from Eli Employee)', over_40: true }),
      entry({ id: 'e2', work_date: '2026-10-13', status: 'pending', edited_after_decision: true, label: 'Pending approval' }),
      entry({ id: 'e3', work_date: '2026-10-14', status: 'rejected', label: 'Rejected', rejection_reason: 'Wrong milestone' }),
    ]))
    renderSheet()
    expect(await screen.findByText('Pending (Overtime requested from Eli Employee)')).toBeInTheDocument()
    expect(screen.getByText('Edited')).toBeInTheDocument()
    const rejected = screen.getByText('Rejected')
    await userEvent.hover(rejected)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Wrong milestone')
  })

  test('a rejected cell can be resubmitted with the same hours', async () => {
    let body = null
    server.use(weekHandler([entry({ id: 'e3', work_date: '2026-10-14', hours: 6, status: 'rejected', label: 'Rejected',
      rejection_reason: 'Check with me' })]),
    http.put(`${API}/time-entries`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ week_start: WEEK, rows, entries: [], totals: { logged: 6, approved: 0 },
        user: { id: users.employee.id, name: 'Eli Employee' } })
    }))
    renderSheet()
    const user = userEvent.setup()
    const save = await screen.findByRole('button', { name: /save week/i })
    expect(save).toBeDisabled()
    await user.click(await screen.findByRole('button', { name: /resubmit schema mapping, wed oct 14/i }))
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: '2026-10-14', hours: 6 }] }))
  })

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
    await user.click(screen.getByRole('button', { name: /save week/i }))
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
    expect(screen.getByText('Tracked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add work note, Schema Mapping, Mon Oct 12' }))
    await user.type(await screen.findByLabelText(/what did you work on/i), 'Mapped the address tables')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Add a note')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save week/i }))
    await waitFor(() => expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WEEK, hours: 8,
      note: 'Mapped the address tables' }] }))
  })

  test('cells say where their hours came from', async () => {
    server.use(weekHandler([entry({ source: 'manual', tracked_hours: 0 }),
      entry({ id: 'e2', work_date: '2026-10-13', source: 'mixed', tracked_hours: 3, note: 'Reviewed the mapping' })]))
    renderSheet()
    expect(await screen.findByText('Manual')).toBeInTheDocument()
    expect(screen.getByText('Mixed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit work note, Schema Mapping, Tue Oct 13' })).toBeInTheDocument()
  })

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
    await user.click(screen.getByRole('button', { name: /save week/i }))
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
    await waitFor(() => expect(read).toBe('n1'))
    expect(screen.getByTestId('location')).toHaveTextContent(`/timesheets?user=${users.employee.id}`)
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
