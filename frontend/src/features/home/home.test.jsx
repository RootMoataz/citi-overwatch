import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import HomePage from './HomePage.jsx'

const dashboard = {
  status_counts: { planned: 1, active: 1, on_hold: 0, completed: 0 },
  projects: [{ id: 'p1', name: 'Apollo', status: 'active', progress_pct: 50, budget_pct: 20, budget: 100000, consumed: 20000,
    predicted_end_date: '2026-12-31', at_risk_reasons: [], manager: { id: 'u-mgr', name: 'Morgan Manager' } }],
  at_risk: [], milestones: { overdue: [], due_soon: [] }, over_allocated: [], budgets: [], pending_approvals: 2,
}

const pendingEntry = (id, name, hours) => ({
  entry: { id, work_date: '2026-10-12', hours, over_40: false, edited_after_decision: false },
  user: { id: `u-${id}`, name }, project: { id: 'p1', name: 'Apollo' }, milestone: { id: 'm1', name: 'Design' },
  label: 'Within plan', week_logged_total: 20,
})

const profile = {
  user: { id: 'u-emp', name: 'Eli Employee', role: 'employee' },
  this_week: { week_start: '2026-10-12', logged: 32, overtime: 0, planned: 40 },
  all_time: { logged: 300, approved: 280 },
  projects: [],
  milestones: [
    { id: 'm1', name: 'Design', status: 'in_progress', difficulty: 'hard', start_date: '2026-10-01', end_date: '2026-10-20',
      is_archived: false, role: 'primary', project: { id: 'p1', name: 'Apollo' }, can_open: true, logged_hours: 10, approved_hours: 8 },
    { id: 'm2', name: 'Old work', status: 'completed', difficulty: 'easy', start_date: '2026-09-01', end_date: '2026-09-10',
      is_archived: false, role: null, project: { id: 'p1', name: 'Apollo' }, can_open: true, logged_hours: 5, approved_hours: 5 },
    { id: 'm3', name: 'Review', status: 'not_started', difficulty: 'medium', start_date: '2026-10-21', end_date: '2026-10-30',
      is_archived: false, role: 'supporting', project: { id: 'p2', name: 'Beacon' }, can_open: true, logged_hours: 0, approved_hours: 0 },
    // A project archived after the milestone started: it stays in your history as a read-only row (can_open false).
    { id: 'm4', name: 'Shelved work', status: 'in_progress', difficulty: 'easy', start_date: '2026-10-01', end_date: '2026-10-15',
      is_archived: false, role: 'primary', project: { id: 'p8', name: 'Shelved', status: 'active', is_archived: true }, can_open: false,
      logged_hours: 3, approved_hours: 3 },
  ],
}

const pullProject = { id: 'p2', name: 'Beacon', status: 'active', work_mode: 'pull' }
const pushProject = { id: 'p1', name: 'Apollo', status: 'active', work_mode: 'push' }
const claimable = { id: 'm7', project_id: 'p2', name: 'Build pipeline', status: 'not_started', difficulty: 'medium',
  end_date: '2026-11-15', can_claim: true, claimable: true }
const taken = { ...claimable, id: 'm8', name: 'Taken already', can_claim: false, claimable: false }

describe('HomePage by role', () => {
  beforeEach(() => server.use(
    http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
    http.get(`${API}/insights/smart`, () => HttpResponse.json([])),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd1', name: 'Technology', is_archived: false }] })),
    http.get(`${API}/allocations`, () => HttpResponse.json([])),
    http.get(`${API}/projects/status-counts`, () => HttpResponse.json({ planned: 1, active: 2, on_hold: 0, completed: 1, archived: 0, total: 4 })),
  ))

  const noDiscussion = http.get(`${API}/milestones/:id/discussion`,
    () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }))
  const headings = (rows) => rows.map((r) => within(r).getByRole('heading', { level: 3 }).textContent)

  test('employees get My week: hours against 40h, their focus and milestones, and what they can claim, not the dashboard', async () => {
    const claimed = []
    server.use(
      http.get(`${API}/users/u-emp/profile`, () => HttpResponse.json(profile)),
      http.get(`${API}/projects`, () => HttpResponse.json({ items: [pushProject, pullProject], total: 2 })),
      http.get(`${API}/projects/p2/milestones`, () => HttpResponse.json([claimable, taken])),
      http.post(`${API}/milestones/m7/claim`, () => { claimed.push('m7'); return HttpResponse.json({ ...claimable, name: 'Build pipeline' }) }),
      noDiscussion,
    )
    renderAsUser(<HomePage />, { user: users.employee, route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: /my week/i })).toBeInTheDocument()
    const week = await screen.findByRole('region', { name: /this week/i })
    expect(within(week).getByText('32h logged')).toBeInTheDocument()
    expect(within(week).getByRole('progressbar', { name: /hours logged this week/i })).toHaveAttribute('aria-valuenow', '80')
    expect(within(week).getByRole('link', { name: /open my timesheet/i })).toHaveAttribute('href', '/timesheet?week=2026-10-12')

    const focus = screen.getByRole('region', { name: 'Your focus' })
    const now = within(focus).getByRole('group', { name: 'Now' })
    expect(within(now).getByRole('heading', { level: 3, name: 'Design' })).toBeInTheDocument()
    expect(within(now).getByText('In progress')).toBeInTheDocument()
    expect(within(now).getByText('Hard difficulty')).toBeInTheDocument()
    expect(within(now).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/p1?tab=milestones')
    expect(within(within(focus).getByRole('group', { name: 'Next' })).getByRole('heading', { level: 3, name: 'Review' }))
      .toBeInTheDocument()

    // Assigned work sits in its group; the unassigned row and the archived project's row are left out.
    const inProgress = within(screen.getByRole('region', { name: /^In progress/ })).getAllByRole('listitem')
    expect(headings(inProgress)).toEqual(['Design'])
    expect(within(inProgress[0]).getByText('Hard Difficulty')).toBeInTheDocument()
    expect(within(inProgress[0]).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/p1?tab=milestones')
    const upcoming = within(screen.getByRole('region', { name: /^Upcoming/ })).getAllByRole('listitem')
    expect(headings(upcoming)).toEqual(['Review'])
    expect(within(upcoming[0]).getByRole('link', { name: 'Beacon' })).toHaveAttribute('href', '/projects/p2?tab=milestones')
    expect(screen.queryByText('Old work')).not.toBeInTheDocument()
    expect(screen.queryByText('Shelved work')).not.toBeInTheDocument()

    const open = await screen.findByRole('region', { name: /available to claim/i })
    await within(open).findByText('Build pipeline')
    expect(within(open).queryByText('Taken already')).not.toBeInTheDocument()
    await userEvent.setup().click(within(open).getByRole('button', { name: /claim build pipeline/i }))
    await waitFor(() => expect(claimed).toEqual(['m7']))

    expect(screen.queryByRole('region', { name: /^risk$/i })).not.toBeInTheDocument()
  })

  test('In progress: overdue first, then the most important, then the soonest due; each shows its priority', async () => {
    const mine = (id, name, end, priority, status = 'in_progress') => ({ id, name, status, priority, difficulty: 'medium',
      start_date: '2020-01-01', end_date: end, is_archived: false, role: 'primary', project: { id: 'p1', name: 'Apollo' },
      can_open: true, logged_hours: 0, approved_hours: 0 })
    server.use(
      http.get(`${API}/users/u-emp/profile`, () => HttpResponse.json({ ...profile, milestones: [
        mine('a', 'Soon low', '2099-01-02', 'low'), mine('b', 'Later critical', '2099-06-01', 'critical'),
        mine('c', 'Late medium', '2020-02-01', 'medium'), mine('d', 'Soon high', '2099-01-03', 'high'),
        mine('e', 'Done critical', '2099-01-01', 'critical', 'completed'), mine('f', 'Late high', '2020-03-01', 'high')] })),
      http.get(`${API}/projects`, () => HttpResponse.json({ items: [pushProject], total: 1 })),
      noDiscussion,
    )
    renderAsUser(<HomePage />, { user: users.employee, route: '/' })
    const region = await screen.findByRole('region', { name: /^In progress/ })
    const rows = within(region).getAllByRole('listitem')
    expect(headings(rows)).toEqual(['Late high', 'Late medium', 'Later critical', 'Soon high', 'Soon low'])
    expect(within(rows[2]).getByLabelText('Priority: Critical')).toHaveTextContent('Critical')
    // Finished work sits in Completed, below the open work.
    const done = within(screen.getByRole('region', { name: /^Completed/ })).getAllByRole('listitem')
    expect(headings(done)).toEqual(['Done critical'])
  })

  test('managers get Approvals and Live now pinned above Risk and Smart insights', async () => {
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([
      pendingEntry('t1', 'Eli Employee', 8), pendingEntry('t2', 'Ada Lovelace', 6), pendingEntry('t3', 'Bo Builder', 4),
      pendingEntry('t4', 'Cy Coder', 2)])))
    renderAsUser(<HomePage />, { user: users.manager, route: '/' })
    const approvals = await screen.findByRole('region', { name: /approvals/i })
    expect(await within(approvals).findByText('4 entries waiting')).toBeInTheDocument()
    expect(within(approvals).getByText(/Eli Employee/)).toBeInTheDocument()
    expect(within(approvals).queryByText(/Cy Coder/)).not.toBeInTheDocument()
    expect(within(approvals).getByRole('link', { name: /review all/i })).toHaveAttribute('href', '/timesheets')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.slice(0, 4)).toEqual(['Approvals', 'Live now', 'Risk', 'Which projects are at risk of missing their deadlines?'])
    expect(screen.getByRole('region', { name: /smart insights/i })).toBeInTheDocument()
  })

  test('managers with nothing pending see that the queue is clear', async () => {
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([])))
    renderAsUser(<HomePage />, { user: users.manager, route: '/' })
    const approvals = await screen.findByRole('region', { name: /approvals/i })
    expect(await within(approvals).findByText(/nothing waiting for approval/i)).toBeInTheDocument()
  })

  test('admins get a control centre with counts and links above the org-wide dashboard', async () => {
    server.use(
      http.get(`${API}/approvals`, () => HttpResponse.json([])),
      http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 27 })),
      http.get(`${API}/project-requests`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('status')).toBe('pending')
        return HttpResponse.json([{ id: 'r1' }, { id: 'r2' }])
      }),
      http.get(`${API}/archive`, () => HttpResponse.json({ items: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] })),
    )
    renderAsUser(<HomePage />, { user: users.admin, route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: /control centre/i })).toBeInTheDocument()
    const centre = screen.getByRole('list', { name: /admin shortcuts/i })
    const tile = (name) => within(centre).getByRole('link', { name })
    await waitFor(() => expect(tile(/people/i)).toHaveTextContent('27'))
    expect(tile(/people/i)).toHaveAttribute('href', '/people')
    expect(tile(/departments/i)).toHaveTextContent('1')
    expect(tile(/departments/i)).toHaveAttribute('href', '/departments')
    await waitFor(() => expect(tile(/open project requests/i)).toHaveTextContent('2'))
    expect(tile(/open project requests/i)).toHaveAttribute('href', '/requests')
    await waitFor(() => expect(tile(/archive/i)).toHaveTextContent('3'))
    expect(tile(/audit log/i)).toHaveAttribute('href', '/audit')
    expect(await screen.findByRole('region', { name: /projects by status/i })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: /^risk$/i })).toBeInTheDocument()
  })
})
