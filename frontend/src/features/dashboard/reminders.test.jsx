import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NotificationBell from '../../components/NotificationBell.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import DashboardPage from './DashboardPage.jsx'

const dashboard = {
  status_counts: { planned: 0, active: 0, on_hold: 0, completed: 0 }, projects: [], at_risk: [],
  milestones: { overdue: [], due_soon: [] }, over_allocated: [], budgets: [], pending_approvals: 0,
}

beforeEach(() => server.use(
  http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
  http.get(`${API}/allocations`, () => HttpResponse.json([])),
  http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/insights/smart`, () => HttpResponse.json([])),
))

describe('Missing timesheets', () => {
  test("a manager sees their people with an empty week, each name opening the person's profile", async () => {
    server.use(http.get(`${API}/timesheet-reminders`, () => HttpResponse.json({ week_start: '2026-10-12', due: true,
      people: [{ id: 'u-ada', name: 'Ada Lovelace', job_title: 'Engineer' }, { id: 'u-bo', name: 'Bo Peep', job_title: '' }] })))
    renderAsUser(<DashboardPage />, { user: users.manager })
    const list = await screen.findByRole('list', { name: 'Missing timesheets for the week of Oct 12, 2026' })
    expect(within(list).getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
    expect(within(list).getByRole('link', { name: 'Bo Peep' })).toBeInTheDocument()
    expect(screen.getByText('2 missing')).toBeInTheDocument()
    expect(screen.getByText(/this week; reminders sent/)).toBeInTheDocument()
  })

  test('before Friday it is about last week, and says so when everyone logged hours', async () => {
    renderAsUser(<DashboardPage />, { user: users.admin })
    expect(await screen.findByText('Everyone has logged hours')).toBeInTheDocument()
    expect(screen.getByText(/week of Oct 5, 2026 \(last week\)/)).toBeInTheDocument()
  })

  test('the department filter narrows the list too', async () => {
    const asked = []
    server.use(http.get(`${API}/timesheet-reminders`, ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('department'))
      return HttpResponse.json({ week_start: '2026-10-05', due: false, people: [] })
    }))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/?department=d1' })
    await screen.findByText('Everyone has logged hours')
    expect(asked).toEqual(['d1'])
  })
})

describe('Print / PDF', () => {
  let print
  beforeEach(() => { print = vi.spyOn(window, 'print').mockImplementation(() => {}) })
  afterEach(() => print.mockRestore())

  test('the dashboard prints through the browser, with a print-only header naming the page, role and time', async () => {
    renderAsUser(<DashboardPage title="Control centre" />, { user: users.admin })
    await userEvent.click(await screen.findByRole('button', { name: 'Print / PDF' }))
    expect(print).toHaveBeenCalledTimes(1)
    const header = document.querySelector('[data-print="only"]')
    expect(header).toHaveTextContent('Control centre')
    expect(header).toHaveTextContent(/Printed by Avery Admin \(Admin\) on .*\d{4}/)
  })
})

test('the empty-timesheet reminder opens the timesheet for that week', async () => {
  server.use(
    http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n5', type: 'TIMESHEET_EMPTY', week_start: '2026-10-12',
      read_at: null, subject_user: { id: users.employee.id, name: 'Eli Employee' }, payload: { week_start: '2026-10-12' },
      message: 'Your timesheet for the week of Mon 12 Oct is empty' }])),
    http.post(`${API}/notifications/n5/read`, () => HttpResponse.json({ id: 'n5', read: true })),
  )
  renderAsUser(<NotificationBell />, { user: users.employee, route: '/', path: '/' })
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
  const item = await screen.findByRole('menuitem', { name: /your timesheet for the week of mon 12 oct is empty/i })
  expect(within(item).getByText('Log your hours for that week')).toBeInTheDocument()
  await userEvent.click(item)
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/timesheet?week=2026-10-12'))
})
