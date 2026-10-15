import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const openRows = [
  { milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
  { milestone: { id: 'm2', name: 'Build' }, project: { id: 'p2', name: 'Atlas', status: 'active' }, open: true },
]
const closedRows = [
  { milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
  { milestone: { id: 'm2', name: 'Build' }, project: { id: 'p2', name: 'Atlas', status: 'on_hold' }, open: false },
  { milestone: { id: 'm3', name: 'Wrap up' }, project: { id: 'p3', name: 'Done', status: 'completed' }, open: false },
]
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: WEEK, hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: '', label: 'Pending approval', ...overrides })

function sheetWith({ rows = openRows, entries = [] } = {}) {
  return http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
    user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries, totals: { logged: 0, approved: 0 } }))
}

const renderSheet = () => renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}`, path: '/timesheet' })

describe('Timesheet rules', () => {
  test('a day over 24h across milestones is flagged on that day and blocks Save', async () => {
    server.use(sheetWith())
    renderSheet()
    const user = userEvent.setup()
    const a = await screen.findByLabelText('Schema Mapping, Wed Oct 14')
    const b = screen.getByLabelText('Build, Wed Oct 14')
    await user.type(a, '14')
    expect(screen.queryByText(/more than 24h/i)).not.toBeInTheDocument()
    await user.type(b, '12')
    expect(screen.getByText('More than 24h on Wed Oct 14')).toBeInTheDocument()
    expect(a).toHaveAttribute('aria-invalid', 'true')
    expect(b).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Build, Tue Oct 13')).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByTestId('day-total-2026-10-14')).toHaveTextContent('26h')
    expect(screen.getByTestId('day-total-2026-10-14')).toHaveAttribute('data-over', 'true')
    expect(screen.getByRole('button', { name: /save week/i })).toBeDisabled()
    await user.clear(b)
    await user.type(b, '10')
    expect(screen.queryByText(/more than 24h/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save week/i })).toBeEnabled()
  })

  test('saved hours on another milestone count toward the day; rejected ones do not', async () => {
    server.use(sheetWith({ entries: [
      entry({ id: 'e1', work_date: '2026-10-14', hours: 20 }),
      entry({ id: 'e2', work_date: '2026-10-15', hours: 20, status: 'rejected', label: 'Rejected' }),
    ] }))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Thu Oct 15'), '10')
    expect(screen.queryByText(/more than 24h/i)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Build, Wed Oct 14'), '5')
    expect(screen.getByText('More than 24h on Wed Oct 14')).toBeInTheDocument()
  })

  test("the server's refusal is shown clearly", async () => {
    server.use(sheetWith(), http.put(`${API}/time-entries`, () => HttpResponse.json({ error: { code: 'DAY_OVER_24H',
      message: "More than 24h on Wed 14 Oct (26h across your milestones). A day can't go over 24 hours.", request_id: 'r-24' } },
    { status: 400 })))
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Build, Wed Oct 14'), '4')
    await user.click(screen.getByRole('button', { name: /save week/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn't save your week/i)
    expect(alert).toHaveTextContent('More than 24h on Wed 14 Oct (26h across your milestones)')
    expect(alert).toHaveTextContent('r-24')
  })

  test('going over 40h warns before saving but does not block it', async () => {
    server.use(sheetWith({ entries: [0, 1, 2, 3].map((n) => entry({ id: `e${n}`, work_date: `2026-10-1${2 + n}`, hours: 10 })) }))
    renderSheet()
    const user = userEvent.setup()
    await screen.findByLabelText('Build, Fri Oct 16')
    expect(screen.queryByText(/over 40h/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('week-total')).toHaveAttribute('data-over', 'false')
    await user.type(screen.getByLabelText('Build, Fri Oct 16'), '5')
    expect(screen.getByText('This week is 45h — 5h over 40h. Hours above 40 are sent to your manager as an overtime request.'))
      .toBeInTheDocument()
    expect(screen.getByTestId('week-total')).toHaveAttribute('data-over', 'true')
    expect(screen.getByRole('button', { name: /save week/i })).toBeEnabled()
  })

  test('rows on an on-hold project are greyed out and read-only, completed ones are closed', async () => {
    server.use(sheetWith({ rows: closedRows, entries: [
      entry({ id: 'e2', milestone_id: 'm2', project_id: 'p2', hours: 3 }),
      entry({ id: 'e3', milestone_id: 'm3', project_id: 'p3', work_date: '2026-10-13', hours: 2, status: 'rejected', label: 'Rejected' }),
    ] }))
    renderSheet()
    const held = await screen.findByLabelText('Build, Mon Oct 12')
    expect(held).toBeDisabled()
    expect(held).toHaveValue('3')
    expect(screen.getByLabelText('Build, Tue Oct 13')).toBeDisabled()
    expect(screen.getByText('Project on hold — logging paused')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /build/i })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Wrap up, Tue Oct 13')).toBeDisabled()
    expect(screen.getByText('Project completed — logging closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resubmit wrap up/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Schema Mapping, Mon Oct 12')).toBeEnabled()
    expect(screen.getByRole('row', { name: /schema mapping/i })).not.toHaveAttribute('aria-disabled')
  })
})
