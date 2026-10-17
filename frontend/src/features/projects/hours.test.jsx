import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { bold } from '../../test/bold.js'
import { setViewport } from '../../test/setup.js'
import { projectView } from './viewer.js'
import HoursTab from './HoursTab.jsx'

// Thursday 15 Oct 2026, noon in New York. Only Date is faked: faking every timer makes userEvent hang.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  server.events.removeAllListeners()
  setViewport(1280)
})

const project = { id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31',
  manager: { id: users.manager.id, name: 'Morgan Manager' } }

const allocations = [
  { user: { id: 'u1', name: 'Ada Lovelace', job_title: 'Analyst' }, planned_total: 30, logged_total: 32, utilization_pct: 80,
    projects: [{ id: 'p1', name: 'Apollo', planned: 20, logged: 24, approved: 10 }, { id: 'p2', name: 'Atlas', planned: 10, logged: 8, approved: 8 }] },
  { user: { id: 'u3', name: 'Cy Doe', job_title: 'Analyst' }, planned_total: 10, logged_total: 10, utilization_pct: 100,
    projects: [{ id: 'p1', name: 'Apollo', planned: 10, logged: 10, approved: 10 }] },
  { user: { id: 'u2', name: 'Bo Peep', job_title: 'Engineer' }, planned_total: 10, logged_total: 5, utilization_pct: 12.5,
    projects: [{ id: 'p2', name: 'Atlas', planned: 10, logged: 5, approved: 5 }] },
]
const entry = (id, milestone, hours, status) => ({ id, project_id: 'p1', milestone_id: milestone, work_date: '2026-10-13', hours, status })

function renderTab(user, { route = '/hours-under-test', requests = [], alloc = allocations, entries = [], team = [{ user: { id: users.employee.id, first_name: 'Eli', last_name: 'Employee' }, planned_hours_per_week: 12 }] } = {}) {
  const note = (request) => { const url = new URL(request.url); requests.push(url.pathname + url.search) }
  server.use(
    http.get(`${API}/allocations`, ({ request }) => { note(request); return HttpResponse.json(alloc) }),
    http.get(`${API}/time-entries`, ({ request }) => { note(request)
      return HttpResponse.json({ rows: [], entries, totals: { logged: 0, approved: 0 } }) }),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json(team)),
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([
      { id: 'm1', name: 'Discovery', project_id: 'p1', is_archived: false }, { id: 'm2', name: 'Build', project_id: 'p1', is_archived: false }])),
  )
  return renderAsUser(<HoursTab project={project} manage view={projectView(user, project)} user={user} />, { user, route })
}
const location = () => screen.getByTestId('location').textContent

describe('HoursTab week bar', () => {
  test('names the week, steps it in the URL and returns to this week', async () => {
    const user = userEvent.setup()
    renderTab(users.manager, { route: '/hours-under-test?tab=hours' })
    expect(await screen.findByText('Oct 12 – 18, 2026')).toBeInTheDocument()
    expect(screen.getByText('Project hours · This week')).toBeInTheDocument()
    expect(screen.getByText('As of Oct 15, 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(location()).toContain('week=2026-10-19')
    expect(location()).toContain('tab=hours')
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(location()).toContain('week=2026-10-05')
    expect(screen.getByText('Project hours · Week of Oct 5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(location()).not.toContain('week=')
    expect(location()).toContain('tab=hours')
  })

  test("picking any day in a week sets that week's Monday", async () => {
    const user = userEvent.setup()
    renderTab(users.manager)
    await user.click(await screen.findByRole('button', { name: 'Pick a week' }))
    fireEvent.change(screen.getByLabelText('Any day in the week'), { target: { value: '2026-10-07' } })
    await waitFor(() => expect(location()).toContain('week=2026-10-05'))
  })
})

describe('HoursTab team table', () => {
  test('shows the figures, review links, overage, total and banner', async () => {
    renderTab(users.manager)
    const row = (await screen.findByRole('rowheader', { name: /Ada Lovelace/ })).closest('tr')
    expect(within(row).getByText('20h')).toBeInTheDocument()
    expect(within(row).getByText('24h')).toBeInTheDocument()
    expect(within(row).getByText('10h')).toBeInTheDocument()
    expect(within(row).getByText('14h')).toHaveAttribute('data-tone', 'warning')   // pending above 0: the warning colour
    expect(within(row).getByText('4h above project plan')).toBeInTheDocument()
    expect(within(row).getByText('Analyst')).toBeInTheDocument()
    expect(within(row).getByText('AL')).toBeInTheDocument()
    expect(row).toHaveAttribute('data-tone', 'warning')
    expect(within(screen.getByRole('rowheader', { name: /Cy Doe/ }).closest('tr')).queryByText(/above project plan/)).not.toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'View entries' })).toHaveAttribute('href', '/timesheets?project=p1&user=u1')
    const cy = screen.getByRole('rowheader', { name: /Cy Doe/ }).closest('tr')
    expect(within(cy).getByText('0h')).not.toHaveAttribute('data-tone')   // nothing pending: plain
    expect(within(cy).getByText('—')).toBeInTheDocument()
    expect(within(cy).queryByRole('link', { name: 'View entries' })).not.toBeInTheDocument()
    const total = screen.getByRole('rowheader', { name: 'Total' }).closest('tr')
    expect(within(total).getByText('30h')).toBeInTheDocument()
    expect(within(total).getByText('34h')).toBeInTheDocument()
    expect(within(total).getByText('20h')).toBeInTheDocument()
    expect(within(total).getByText('14h')).toBeInTheDocument()
    expect(screen.getByRole('alert'))
      .toHaveTextContent('14h awaiting approval this week · Pending hours do not contribute to approved project spend.')
    expect(screen.getByRole('link', { name: "Review this week's entries →" })).toHaveAttribute('href', '/timesheets?project=p1')
    expect(screen.getByText('Planned hours are weekly allocations. This is not a measure of productivity.')).toBeInTheDocument()
    expect(screen.queryByText('Bo Peep')).not.toBeInTheDocument()
  })

  test('shows the four figures with Logged explained', async () => {
    renderTab(users.manager)
    const strip = await screen.findByRole('group', { name: 'Hours this week' })
    for (const label of ['Planned', 'Logged', 'Approved', 'Pending']) expect(await within(strip).findByText(label)).toBeInTheDocument()
    expect(within(strip).getByRole('img', { name: 'Logged means pending + approved. Rejected hours excluded.' })).toBeInTheDocument()
  })

  test('asks for the chosen week', async () => {
    const requests = []
    renderTab(users.manager, { route: '/hours-under-test?week=2026-10-05', requests })
    await screen.findByText('Ada Lovelace')
    expect(requests.some((r) => r.includes('/allocations') && r.includes('week=2026-10-05'))).toBe(true)
  })

  test('says so when nobody logged hours', async () => {
    renderTab(users.manager, { alloc: [] })
    expect(await screen.findByText('No hours this week')).toBeInTheDocument()
    expect(screen.getByText('Hours appear as the team logs them.')).toBeInTheDocument()
  })

  test('stacks as cards on a phone', async () => {
    setViewport(375)
    renderTab(users.manager)
    const card = (await screen.findByText('Ada Lovelace')).closest('[data-tone]')
    expect(card).toHaveAttribute('data-tone', 'warning')
    expect(within(card).getByText('Analyst')).toBeInTheDocument()
    expect(within(card).getByText('AL')).toBeInTheDocument()
    expect(within(card).getByText('4h above project plan')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('HoursTab for an employee', () => {
  test('shows their own hours by milestone and never requests allocations', async () => {
    const requests = []
    renderTab(users.employee, { requests, entries: [
      entry('e1', 'm1', 6, 'approved'), entry('e2', 'm1', 3, 'pending'), entry('e3', 'm2', 2, 'rejected'), entry('e4', 'm2', 4, 'pending'),
      { ...entry('e5', 'm9', 5, 'approved'), project_id: 'p2' }] })
    expect(await screen.findByRole('heading', { name: 'Your hours' })).toBeInTheDocument()
    const build = (await screen.findByRole('rowheader', { name: 'Build' })).closest('tr')
    // Logged leaves out the rejected hours; they show as needing revision.
    expect(within(build).getAllByRole('cell').map((c) => c.textContent)).toEqual(['4h', '0h', '4h', '2h'])
    const disc = screen.getByRole('rowheader', { name: 'Discovery' }).closest('tr')
    expect(within(disc).getAllByRole('cell').map((c) => c.textContent)).toEqual(['9h', '6h', '3h', '0h'])
    for (const h of ['Milestone', 'Logged', 'Approved', 'Pending', 'Needs revision']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open my timesheet' })).toHaveAttribute('href', '/timesheet?week=2026-10-12')
    expect(requests.some((r) => r.includes('/time-entries') && r.includes('week=2026-10-12'))).toBe(true)
    expect(requests.some((r) => r.includes('/allocations'))).toBe(false)
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    const strip = screen.getByRole('group', { name: 'Your hours this week' })
    const value = (label) => within(strip).getByText(label).parentElement.textContent
    expect(value('Planned')).toBe('Planned12h')
    expect(value('Logged')).toContain('13h')
    expect(value('Approved')).toBe('Approved6h')
    expect(value('Pending')).toBe('Pending7h')
    expect(within(strip).getByRole('img', { name: 'Logged means pending + approved. Rejected hours excluded.' })).toBeInTheDocument()
  })

  test('names a milestone that is no longer listed, and shows Planned as a dash off the team', async () => {
    renderTab(users.employee, { entries: [entry('e1', 'm9', 2, 'pending')], team: [] })
    expect(await screen.findByText('Unknown milestone')).toBeInTheDocument()
    const strip = screen.getByRole('group', { name: 'Your hours this week' })
    await waitFor(() => expect(within(strip).getByText('Planned').parentElement.textContent).toBe('Planned—'))
  })

  test('says so when they logged nothing on this project', async () => {
    renderTab(users.employee, { entries: [] })
    expect(await screen.findByText('No hours this week')).toBeInTheDocument()
  })
})

describe('HoursTab for an executive', () => {
  test('is private and requests nothing', async () => {
    const requests = []
    renderTab(users.executive, { requests })
    expect(await screen.findByText('Team hours are private')).toBeInTheDocument()
    expect(screen.getByText("Only the project's manager and admins see everyone's hours.")).toBeInTheDocument()
    expect(requests).toEqual([])
  })
})

describe('HoursTab: the critical details are bold', () => {
  test('hours above the project plan and the hours awaiting approval', async () => {
    renderTab(users.manager)
    const row = (await screen.findByRole('rowheader', { name: /Ada Lovelace/ })).closest('tr')
    expect(bold(row)).toEqual(['4h above project plan'])
    expect(bold(screen.getByRole('rowheader', { name: /Cy Doe/ }).closest('tr'))).toEqual([])
    expect(bold(screen.getByRole('alert'))).toEqual(['14h awaiting approval'])
  })
})
