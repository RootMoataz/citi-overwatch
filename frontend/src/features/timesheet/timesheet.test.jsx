import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import Layout from '../../app/Layout.jsx'
import NotificationBell from '../../components/NotificationBell.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../../test/render.jsx'
import ApprovalsPage from '../approvals/ApprovalsPage.jsx'
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
    expect(await screen.findByText(/hours over 24/i)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Build, Wed Oct 14'))
    await user.click(screen.getByRole('button', { name: /save week/i }))
    await waitFor(() => expect(puts).toBe(1))
    expect(body).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: '2026-10-13', hours: 9 }] })
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

describe('ApprovalsPage', () => {
  test('reject requires a reason', async () => {
    let body = null
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([pending])),
      http.post(`${API}/time-entries/e9/reject`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    renderAsUser(<ApprovalsPage />, { user: users.manager, route: '/approvals', path: '/approvals' })
    const user = userEvent.setup()
    expect(await screen.findByText('Pending (Overtime requested from Eli Employee)')).toBeInTheDocument()
    expect(screen.getByText('45h this week')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^reject/i }))
    const dialog = await screen.findByRole('dialog', { name: /reject these hours/i })
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    expect(await within(dialog).findByText('Tell the employee why')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/reason/i), 'Wrong milestone')
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(body).toEqual({ reason: 'Wrong milestone' }))
  })

  test('approve removes the row', async () => {
    let list = [pending]
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json(list)),
      http.post(`${API}/time-entries/e9/approve`, () => { list = []; return HttpResponse.json({}) }))
    renderAsUser(<ApprovalsPage />, { user: users.manager, route: '/approvals', path: '/approvals' })
    await userEvent.click(await screen.findByRole('button', { name: /^approve/i }))
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument()
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
    expect(screen.getByTestId('location')).toHaveTextContent(`/approvals?user=${users.employee.id}`)
  })
})

test('employee does not see Approvals in navigation', () => {
  renderWithProviders(<Routes><Route path="*" element={<Layout user={users.employee} />} /></Routes>)
  expect(screen.getByRole('navigation', { name: /main/i })).not.toHaveTextContent('Approvals')
})
