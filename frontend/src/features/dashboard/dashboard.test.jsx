import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import AllocationPage from '../allocation/AllocationPage.jsx'
import DashboardPage from './DashboardPage.jsx'

const project = (overrides) => ({ id: 'p1', name: 'Apollo', status: 'active', progress_pct: 33.3, budget_pct: 20,
  budget: 250000, consumed: 50000, predicted_end_date: '2026-12-31', at_risk_reasons: [],
  manager: { id: 'u-mgr', name: 'Morgan Manager' }, ...overrides })

const dashboard = {
  status_counts: { planned: 1, active: 2, on_hold: 1, completed: 1 },
  projects: [project(), project({ id: 'p2', name: 'Atlas', at_risk_reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] })],
  at_risk: [{ id: 'p2', name: 'Atlas', reasons: ['PAST_DUE', 'OVERDUE_MILESTONE'] }],
  milestones: { overdue: [{ id: 'm9', name: 'Build', end_date: '2026-10-05', status: 'in_progress', project: { id: 'p2', name: 'Atlas' } }],
    due_soon: [{ id: 'm2', name: 'Schema Mapping', end_date: '2026-10-20', status: 'in_progress', project: { id: 'p1', name: 'Apollo' } }] },
  over_allocated: [{ user: { id: 'u-emp', name: 'Eli Employee' }, week_logged_total: 45 }],
  budgets: [{ project_id: 'p1', name: 'Apollo', budget: 250000, consumed: 50000, forecast: 120000 },
    { project_id: 'p2', name: 'Atlas', budget: 60000, consumed: 58000, forecast: 70000 }],
  pending_approvals: 6,
}

const allocations = [{ user: { id: 'u-emp', name: 'Eli Employee', job_title: 'Engineer' }, planned_total: 40, logged_total: 45,
  utilization_pct: 112.5, projects: [{ id: 'p1', name: 'Apollo', planned: 30, logged: 45, approved: 0 },
    { id: 'p2', name: 'Atlas', planned: 10, logged: 0, approved: 0 }] }]

describe('DashboardPage', () => {
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
    const risk = screen.getByRole('region', { name: /at risk/i })
    expect(within(risk).getByText('Past due date')).toBeInTheDocument()
    const over = screen.getByRole('region', { name: /over-allocated/i })
    expect(within(over).getByText('Eli Employee')).toBeInTheDocument()
    expect(within(over).getByText('45h')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /key deliverables/i })).getByText('Build')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /dependency chain/i })).getAllByRole('link', { name: /timeline/i })).toHaveLength(2)
    expect(screen.getByText('6 waiting for your approval')).toBeInTheDocument()
  })

  test('budget chart names projects whose forecast is over budget', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    const section = await screen.findByRole('region', { name: /budget has been consumed versus planned/i })
    const note = within(section).getByRole('note')
    expect(note).toHaveTextContent('Forecast over budget: Atlas ($70,000 forecast vs $60,000 budget)')
    expect(note).not.toHaveTextContent('Apollo')
  })

  test('budget chart says when every forecast is within budget', async () => {
    server.use(http.get(`${API}/dashboard`, () => HttpResponse.json({ ...dashboard, budgets: [dashboard.budgets[0]] })),
      http.get(`${API}/allocations`, () => HttpResponse.json(allocations)))
    renderAsUser(<DashboardPage />, { user: users.admin, route: '/dashboard-under-test' })
    const section = await screen.findByRole('region', { name: /budget has been consumed versus planned/i })
    expect(within(section).getByRole('note')).toHaveTextContent('Every forecast is within budget.')
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
    const row = (await screen.findByText('Eli Employee')).closest('tr')
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
    expect(screen.getByRole('region', { name: /logged hours by project/i })).toBeInTheDocument()
    const grid = screen.getByRole('table', { name: /allocation by person and project/i })
    expect(within(grid).getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
  })

  test('chart note says when nobody is over 40h', async () => {
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json([{ ...allocations[0], logged_total: 40, utilization_pct: 100 }])))
    renderAsUser(<AllocationPage />, { user: users.manager, route: '/allocation', path: '/allocation' })
    const chart = await screen.findByRole('region', { name: /planned vs logged this week/i })
    expect(within(chart).getByRole('note')).toHaveTextContent('Nobody is over 40h this week.')
  })
})
