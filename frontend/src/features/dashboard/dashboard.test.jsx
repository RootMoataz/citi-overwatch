import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import AllocationPage from '../allocation/AllocationPage.jsx'
import DashboardPage from './DashboardPage.jsx'

const project = (overrides) => ({ id: 'p1', name: 'Apollo', status: 'active', progress_pct: 33.3, budget_pct: 20,
  budget: 250000, consumed: 50000, predicted_end_date: '2026-12-31', at_risk_reasons: [],
  manager: { id: 'u-mgr', name: 'Morgan Manager' }, ...overrides })

const dashboard = {
  status_counts: { planned: 1, active: 2, on_hold: 1, completed: 1 },
  projects: [project(), project({ id: 'p2', name: 'Atlas', at_risk_reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] })],
  at_risk: [{ id: 'p2', name: 'Atlas', reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] }],
  milestones: { overdue: [{ id: 'm9', name: 'Build', end_date: '2026-10-05', status: 'in_progress', priority: 'critical',
    project: { id: 'p2', name: 'Atlas' } }],
    due_soon: [{ id: 'm2', name: 'Schema Mapping', end_date: '2026-10-20', status: 'in_progress', priority: 'high',
      project: { id: 'p1', name: 'Apollo' } }] },
  over_allocated: [{ user: { id: 'u-emp', name: 'Eli Employee' }, week_logged_total: 45 }],
  budgets: [{ project_id: 'p1', name: 'Apollo', budget: 250000, consumed: 50000, forecast: 120000 },
    { project_id: 'p2', name: 'Atlas', budget: 60000, consumed: 58000, forecast: 70000 }],
  pending_approvals: 6,
}

const allocations = [{ user: { id: 'u-emp', name: 'Eli Employee', job_title: 'Engineer' }, planned_total: 40, logged_total: 45,
  utilization_pct: 112.5, projects: [{ id: 'p1', name: 'Apollo', planned: 30, logged: 45, approved: 0 },
    { id: 'p2', name: 'Atlas', planned: 10, logged: 0, approved: 0 }] }]

const departments = [{ id: 'd1', name: 'Technology', is_archived: false }, { id: 'd2', name: 'Operations', is_archived: false }]

describe('DashboardPage', () => {
  beforeEach(() => server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: departments }))))
  beforeEach(() => server.use(http.get(`${API}/insights/smart`, () => HttpResponse.json([]))))

  test('the department filter asks the server for that department and keeps it in the URL', async () => {
    const asked = []
    const insightsAsked = []
    server.use(http.get(`${API}/insights/smart`, ({ request }) => {
      insightsAsked.push(new URL(request.url).searchParams.get('department'))
      return HttpResponse.json([])
    }))
    server.use(http.get(`${API}/dashboard`, ({ request }) => {
      const dept = new URL(request.url).searchParams.get('department')
      asked.push(dept)
      return HttpResponse.json(dept === 'd1' ? { ...dashboard, projects: [project()], at_risk: [], budgets: [dashboard.budgets[0]] } : dashboard)
    }), http.get(`${API}/allocations`, () => HttpResponse.json([
      ...allocations, { ...allocations[0], user: { id: 'u-ops', name: 'Otto Ops', job_title: 'Ops', department_id: 'd2' } }])))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/' })
    const user = userEvent.setup()
    const busiest = await screen.findByRole('table', { name: /busiest people/i })
    expect(within(busiest).getByText('Otto Ops')).toBeInTheDocument()
    await user.click(await screen.findByRole('combobox', { name: /department/i }))
    expect(screen.getByRole('option', { name: 'All departments' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Technology' }))
    await waitFor(() => expect(asked).toContain('d1'))
    expect(asked[0]).toBeNull()
    await waitFor(() => expect(insightsAsked).toContain('d1'))
    expect(insightsAsked[0]).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent('/?department=d1')
    await waitFor(() => expect(screen.queryByText('Nothing at risk')).toBeInTheDocument())
    const allocation = screen.getByRole('region', { name: /resources allocated/i })
    expect(within(allocation).queryByText('Otto Ops')).not.toBeInTheDocument()
  })

  test('dashboard renders a section for each of the seven questions', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    const headings = [
      /status of each active project/i, /at risk of missing/i, /resources allocated/i, /key deliverables/i,
      /over-allocated/i, /dependency chain/i, /budget has been consumed versus planned/i,
    ]
    for (const name of headings) expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument()
    const status = screen.getByRole('region', { name: /status of each active project/i })
    expect(within(status).getByText('Active')).toBeInTheDocument()
    expect(within(status).getByRole('columnheader', { name: /progress \(weighted by difficulty\)/i })).toBeInTheDocument()
    const risk = screen.getByRole('region', { name: /at risk/i })
    expect(within(risk).getByText('Past due date')).toBeInTheDocument()
    const over = screen.getByRole('region', { name: /over-allocated/i })
    expect(within(over).getByText('Eli Employee')).toBeInTheDocument()
    expect(within(over).getByText('45h')).toBeInTheDocument()
    const deliverables = screen.getByRole('region', { name: /key deliverables/i })
    expect(within(deliverables).getByText('Build')).toBeInTheDocument()
    expect(within(deliverables).getByLabelText('Priority: Critical')).toBeInTheDocument()
    expect(within(deliverables).getByLabelText('Priority: High')).toBeInTheDocument()
    const timelines = within(screen.getByRole('region', { name: /dependency chain/i })).getAllByRole('link', { name: /timeline/i })
    expect(timelines).toHaveLength(2)
    timelines.forEach((link) => expect(link).toHaveAttribute('href', expect.stringMatching(/^\/projects\/[^?]+\?tab=milestones&view=timeline$/)))
    expect(screen.getByText('6 waiting for your approval')).toBeInTheDocument()
  })

  test('the Risk section comes first, with counts by reason above the at-risk list', async () => {
    const atRisk = [{ id: 'p2', name: 'Atlas', reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] },
      { id: 'p3', name: 'Zephyr', reasons: ['OVERDUE_MILESTONE', 'BUDGET_BURN'] },
      { id: 'p4', name: 'Orion', reasons: ['OVERDUE_MILESTONE'] }]
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json({ ...dashboard, at_risk: atRisk })),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    const risk = await screen.findByRole('region', { name: /^risk$/i })
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(/^Risk$/)
    const counts = within(within(risk).getByRole('list', { name: /at-risk projects by reason/i })).getAllByRole('listitem').map((li) => li.textContent)
    expect(counts).toEqual(['At-risk projects3', 'Overdue milestone3', 'Past due date1', 'Budget burning faster than progress1',
      'Kicked back – needs review0'])
    const list = within(risk).getByRole('region', { name: /at risk of missing/i })
    expect(within(list).getAllByRole('link').map((a) => a.textContent)).toEqual(['Atlas', 'Zephyr', 'Orion'])
    const order = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')).textContent)
    expect(order.slice(0, 4)).toEqual(['Risk', 'Which projects are at risk of missing their deadlines?', 'Smart insights',
      'What is the status of each active project?'])
  })

  test('with nothing at risk the counts are zero and the empty state shows', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json({ ...dashboard, at_risk: [] })))
    renderAsUser(<DashboardPage />, { user: users.employee, route: '/dashboard-under-test' })
    const risk = await screen.findByRole('region', { name: /^risk$/i })
    expect(within(within(risk).getByRole('list', { name: /at-risk projects by reason/i })).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['At-risk projects0', 'Overdue milestone0', 'Past due date0', 'Budget burning faster than progress0',
        'Kicked back – needs review0'])
    expect(within(risk).getByText('Nothing at risk')).toBeInTheDocument()
  })

  test('budget chart names projects whose forecast is over budget', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    const section = await screen.findByRole('region', { name: /budget has been consumed versus planned/i })
    const note = within(section).getByRole('note')
    expect(note).toHaveTextContent('Forecast over budget: Atlas ($70,000 forecast vs $60,000 budget)')
    expect(note).not.toHaveTextContent('Apollo')
    // One bullet per project on a % of budget scale, most used first; the over-budget forecast is said in words too.
    const rows = within(within(section).getByRole('list', { name: /budget used per project/i })).getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Atlas. Budget $60,000. Consumed $58,000 (96.7%). Forecast at end date $70,000 (116.7%) · ⚠ forecast over budget',
      'Apollo. Budget $250,000. Consumed $50,000 (20%). Forecast at end date $120,000 (48%)'])
    expect(within(rows[0]).getByText('96.7% used')).toBeInTheDocument()
    // Each project name opens that project's Budget tab.
    expect(within(rows[1]).getByRole('link', { name: 'Open Apollo' })).toHaveAttribute('href', '/projects/p1?tab=budget')
  })

  test('budget chart says when every forecast is within budget', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json({ ...dashboard, budgets: [dashboard.budgets[0]] })),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    const section = await screen.findByRole('region', { name: /budget has been consumed versus planned/i })
    expect(within(section).getByRole('note')).toHaveTextContent('Every forecast is within budget.')
  })

  test('people in the over-allocated list and the allocation table get an avatar beside their name', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.manager, route: '/' })
    const table = await screen.findByRole('table', { name: /busiest people this week/i })
    const name = within(table).getByRole('link', { name: 'Eli Employee' })   // the server scoped this list to their people
    expect(name).toHaveAttribute('href', '/people/u-emp/profile')
    expect(name.closest('[title]').parentElement).toHaveTextContent('EEEli Employee')
  })

  test('employee dashboard skips the team allocation table', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json({ ...dashboard, pending_approvals: 0, over_allocated: [] })))
    renderAsUser(<DashboardPage />, { user: users.employee, route: '/dashboard-under-test' })
    const section = await screen.findByRole('region', { name: /resources allocated/i })
    expect(within(section).getByText(/my timesheet/i)).toBeInTheDocument()
    expect(screen.queryByText(/waiting for your approval/i)).not.toBeInTheDocument()
  })
})

describe('AllocationPage', () => {
  test('shows planned vs logged per person with utilization', async () => {
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    const grid = await screen.findByRole('table', { name: /allocation by person and project/i })
    const row = within(grid).getByText('Eli Employee').closest('tr')
    expect(within(row).getByText('112.5%')).toBeInTheDocument()
    expect(within(row).getByText('30h planned · 45h logged')).toBeInTheDocument()
  })

  test('charts flag people over 40h in text and link names to their profiles', async () => {
    const ada = { user: { id: 'u-ada', name: 'Ada Lovelace', job_title: 'Analyst' }, planned_total: 20, logged_total: 12,
      utilization_pct: 30, projects: [{ id: 'p2', name: 'Atlas', planned: 20, logged: 8, approved: 8 }] }
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json([...allocations, ada])))
    renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    const chart = await screen.findByRole('region', { name: /planned vs logged this week/i })
    const note = within(chart).getByRole('note')
    expect(note).toHaveTextContent('Over 40h this week: Eli Employee (45h)')
    expect(note).not.toHaveTextContent('Ada')
    expect(within(note).getByRole('link', { name: /eli employee/i })).toHaveAttribute('href', '/people/u-emp/profile')
    const bars = within(within(chart).getByRole('list', { name: /logged and planned hours per person/i })).getAllByRole('listitem')
    expect(bars.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Eli Employee. Logged 45h (over 40h). Planned 40h', 'Ada Lovelace. Logged 12h. Planned 20h'])
    expect(screen.getByRole('region', { name: /logged hours by project/i })).toBeInTheDocument()
    const grid = screen.getByRole('table', { name: /allocation by person and project/i })
    expect(within(grid).getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
  })

  test("project names are plain text, never links: a column can be a project the viewer can't open", async () => {
    // W-4: Eli is also on Atlas, which another manager runs. His week counts it, but Allocation offers no way into a
    // project (the project page would answer 404 and send the viewer home), on the table or on the phone cards.
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    const { unmount } = renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    const grid = await screen.findByRole('table', { name: /allocation by person and project/i })
    expect(within(grid).getByRole('columnheader', { name: 'Atlas' })).toBeInTheDocument()
    expect(within(grid).getAllByRole('link').map((a) => a.textContent)).toEqual(['Eli Employee'])
    unmount()
    setViewport(375)
    renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    expect(await screen.findByText('Atlas: 10h planned · 0h logged')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Atlas|Apollo/ })).not.toBeInTheDocument()
  })

  test('chart note says when nobody is over 40h', async () => {
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json([{ ...allocations[0], logged_total: 40, utilization_pct: 100 }])))
    renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    const chart = await screen.findByRole('region', { name: /planned vs logged this week/i })
    expect(within(chart).getByRole('note')).toHaveTextContent('Nobody is over 40h this week.')
  })
})

describe('Dashboard and Allocation: the critical details are bold', () => {
  beforeEach(() => server.use(http.get(`${API}/departments`, () => HttpResponse.json({ items: departments }))))
  beforeEach(() => server.use(http.get(`${API}/insights/smart`, () => HttpResponse.json([]))))
  // Critical renders a <strong>: the `strong` role (see components/critical.test.jsx).
  const bold = (el, options) => within(el).queryAllByRole('strong', options).map((s) => s.textContent)

  test('the pending count, risk tiles and badges, overdue work, urgent priorities, over-40 and over-budget', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    expect(bold(await screen.findByRole('link', { name: '6 waiting for your approval' }))).toEqual(['6 waiting for your approval'])
    const risk = screen.getByRole('region', { name: /^risk$/i })
    // Only the reasons that have a project at risk; the zero tiles stay regular.
    expect(bold(within(risk).getByRole('list', { name: /at-risk projects by reason/i })))
      .toEqual(['At-risk projects', 'Overdue milestone', 'Past due date'])
    expect(bold(within(risk).getByRole('region', { name: /at risk of missing/i }))).toEqual(['Past due date', 'Overdue milestone'])
    // Overdue and the urgent priorities are bold; the In progress states and "Due in the next 14 days" are not.
    expect(bold(screen.getByRole('region', { name: /key deliverables/i }))).toEqual(['Overdue (1)', 'Critical Priority', 'High Priority'])
    expect(bold(screen.getByRole('region', { name: /over-allocated/i }))).toEqual(['45h'])
    expect(bold(screen.getByRole('region', { name: /status of each active project/i }))).toEqual([])
    const budget = screen.getByRole('region', { name: /budget has been consumed versus planned/i })
    expect(bold(within(budget).getByRole('note'))).toEqual(['⚠ Forecast over budget'])
    // The bullet's detail line is drawn for the eye (its words are in the row's name), so it is aria-hidden.
    expect(bold(within(budget).getByRole('list', { name: /budget used per project/i }), { hidden: true }))
      .toEqual(['⚠ forecast over budget'])
  })

  test('the allocation chart note names who is over 40h after a bold "⚠ Over 40h this week"', async () => {
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    const chart = await screen.findByRole('region', { name: /planned vs logged this week/i })
    expect(bold(within(chart).getByRole('note'))).toEqual(['⚠ Over 40h this week'])
  })
})
