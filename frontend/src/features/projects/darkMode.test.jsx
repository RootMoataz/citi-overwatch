import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setPrefersDark } from '../../test/setup.js'
import ProjectDetailPage from './ProjectDetailPage.jsx'
import ProjectsPage from './ProjectsPage.jsx'

const project = {
  id: 'p1', name: 'Apollo Data Migration', description: 'Move records', status: 'active',
  start_date: '2026-07-15', predicted_end_date: '2026-12-27', budget: 250000, consumed: 21745,
  budget_pct: 8.7, progress_pct: 33.3, at_risk_reasons: ['budget_burn'], is_archived: false, completed_at: null,
  manager: { id: users.manager.id, name: 'Morgan Manager' },
}
const ada = { id: 'u-ada', first_name: 'Ada', last_name: 'Lovelace', job_title: 'Analyst', username: 'ada' }
const milestone = {
  id: 'm1', project_id: 'p1', name: 'Discovery', description: '', status: 'in_progress', display_status: 'in_progress',
  blocked: false, predecessors: [], assignees: [{ id: ada.id, name: 'Ada Lovelace' }], supporting_ids: [], is_assignee: false,
  completed_at: null, is_archived: false, difficulty: 'medium', priority: 'medium', estimated_hours: 100, logged_hours: 40,
  open_kickback: null, start_date: '2026-07-15', end_date: '2026-10-30', required_skills: [],
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
  setPrefersDark(true)
  server.use(
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [project], total: 1,
      counts: { total: 1, active: 1, at_risk: 1 } })),
    http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/projects/p1`, () => HttpResponse.json(project)),
    http.get(`${API}/projects/p1/summary`, () => HttpResponse.json({ project, budget: 250000, consumed: 21745,
      remaining: 228255, forecast: 61293, budget_pct: 8.7, progress_pct: 33.3, at_risk_reasons: [], member_count: 1 })),
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([milestone])),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([{ user: ada, planned_hours_per_week: 20 }])),
    http.get(`${API}/projects/p1/milestone-costs`, () => HttpResponse.json({ hours_visible: true,
      items: [{ milestone: { id: 'm1', name: 'Discovery', status: 'in_progress' }, approved_hours: 40, pending_hours: 2,
        approved_cost: 2000, budget_pct: 1 }],
      total: { approved_hours: 40, pending_hours: 2, approved_cost: 2000, budget_pct: 1 } })),
    http.get(`${API}/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/allocations`, () => HttpResponse.json([])),
    http.get(`${API}/milestones/:id/notes`, () => HttpResponse.json([])),
  )
})
afterEach(() => vi.useRealTimers())

describe('dark mode', () => {
  test('the Projects list renders its heading', async () => {
    const errors = vi.spyOn(console, 'error')
    renderAsUser(<ProjectsPage />, { user: users.manager, route: '/projects' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(await screen.findByText('Apollo Data Migration')).toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
  })

  test.each([
    ['overview', 'Milestone schedule'],
    ['milestones', 'Planned schedule'],
    ['team', 'Search team members…'],
    ['budget', 'Cost by milestone'],
    ['hours', 'Project hours · This week'],
  ])('the %s tab renders its headings', async (tab, main) => {
    const errors = vi.spyOn(console, 'error')
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: `/projects/p1?tab=${tab}`, path: '/projects/:id' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Apollo Data Migration' })).toBeInTheDocument()
    if (tab === 'milestones') {
      expect(await screen.findByRole('button', { name: 'List' })).toBeInTheDocument()
    } else {
      expect(await (main.startsWith('Search') ? screen.findByRole('textbox', { name: 'Search team members' }) : screen.findByText(main))).toBeInTheDocument()
    }
    expect(errors).not.toHaveBeenCalled()
  })
})
