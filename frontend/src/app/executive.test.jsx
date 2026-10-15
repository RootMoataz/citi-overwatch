import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'
import ArchivePage from '../features/archive/ArchivePage.jsx'
import HomePage from '../features/home/HomePage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import Layout from './Layout.jsx'

const { executive } = users

const dashboard = {
  status_counts: { planned: 1, active: 1, on_hold: 0, completed: 0 },
  projects: [{ id: 'p1', name: 'Apollo', status: 'active', progress_pct: 50, budget_pct: 20, budget: 100000, consumed: 20000,
    predicted_end_date: '2026-12-31', at_risk_reasons: [], manager: { id: 'u-mgr', name: 'Morgan Manager' } }],
  at_risk: [], milestones: { overdue: [], due_soon: [] }, over_allocated: [], budgets: [], pending_approvals: 0,
}

const project = {
  id: 'p1', name: 'Apollo Data Migration', description: 'Move records', status: 'active',
  start_date: '2026-01-01', predicted_end_date: '2026-12-31', budget: 250000, consumed: 50000,
  budget_pct: 20, progress_pct: 33.3, at_risk_reasons: [], is_archived: false, completed_at: null,
  manager: { id: users.manager.id, name: 'Morgan Manager' }, delegate: null,
}

function projectHandlers() {
  return [
    http.get(`${API}/projects/p1/milestone-costs`, () => HttpResponse.json({ hours_visible: true,
      items: [{ milestone: { id: 'm1', name: 'Schema Mapping', status: 'completed' }, approved_hours: 600, pending_hours: 12,
        approved_cost: 50000, budget_pct: 20 }],
      total: { approved_hours: 600, pending_hours: 12, approved_cost: 50000, budget_pct: 20 } })),
    http.get(`${API}/projects/p1`, () => HttpResponse.json(project)),
    http.get(`${API}/projects/p1/summary`, () => HttpResponse.json({ project, budget: 250000, consumed: 50000, remaining: 200000,
      budget_pct: 20, progress_pct: 33.3, at_risk_reasons: [], member_count: 1 })),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([
      { user: { id: 'u-ada', first_name: 'Ada', last_name: 'Lovelace', job_title: 'Analyst', username: 'ada' },
        planned_hours_per_week: 20 }])),
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([
      { id: 'm1', project_id: 'p1', name: 'Schema Mapping', description: '', start_date: '2026-01-01', end_date: '2026-03-01',
        status: 'in_progress', display_status: 'in_progress', difficulty: 'medium', blocked: false, predecessors: [],
        assignees: [{ id: 'u-ada', name: 'Ada Lovelace' }], supporting_ids: [], is_assignee: false, claimable: false,
        can_claim: false, is_archived: false }])),
  ]
}

describe('executive: read-only leadership view', () => {
  beforeEach(() => server.use(
    http.get(`${API}/dashboard`, () => HttpResponse.json(dashboard)),
    http.get(`${API}/insights/smart`, () => HttpResponse.json([])),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd1', name: 'Technology', is_archived: false }] })),
    http.get(`${API}/allocations`, () => HttpResponse.json([])),
  ))

  test('the navigation lists only the read-only pages, in one group', () => {
    renderWithProviders(
      <Routes><Route element={<Layout user={executive} />}><Route path="/" element={<p>Home</p>} /></Route></Routes>,
    )
    expect(screen.queryByRole('list', { name: /^admin$/i })).not.toBeInTheDocument()
    const work = screen.getByRole('list', { name: /^work$/i })
    expect(within(work).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Dashboard', 'Messages', 'Projects', 'Timesheets', 'Allocation', 'Archive', 'Audit log'])
  })

  test('the account menu names the role', async () => {
    renderWithProviders(
      <Routes><Route element={<Layout user={executive} />}><Route path="/" element={<p>Home</p>} /></Route></Routes>,
    )
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }))
    expect(await screen.findByText('executive.demo · Executive')).toBeInTheDocument()
  })

  test('home is the organisation dashboard with a read-only badge and no admin shortcuts or approvals', async () => {
    let approvalsAsked = false
    server.use(http.get(`${API}/approvals`, () => { approvalsAsked = true; return HttpResponse.json([]) }))
    renderAsUser(<HomePage />, { user: executive, route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: /organisation dashboard/i })).toBeInTheDocument()
    expect(screen.getByText('Read-only view')).toBeInTheDocument()
    expect((await screen.findAllByText('Apollo')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('list', { name: /admin shortcuts/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument()
    expect(approvalsAsked).toBe(false)
  })

  test('a project has no edit, archive or team actions, but shows every tab including hours', async () => {
    server.use(...projectHandlers())
    renderAsUser(<ProjectDetailPage />, { user: executive, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByRole('heading', { name: 'Apollo Data Migration' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: 'Milestones' }))
    expect((await screen.findAllByText('Schema Mapping')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /add milestone|new milestone/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Team' }))
    const list = await screen.findByRole('list', { name: /team members/i })
    expect(await within(list).findByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
    expect(screen.queryByRole('button', { name: /add (member|person)/i })).not.toBeInTheDocument()
    expect(within(list).queryByRole('button')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Budget' }))
    expect((await screen.findAllByText('600h')).length).toBeGreaterThan(0)
  })

  test('the archive lists people too and offers no restore', async () => {
    server.use(http.get(`${API}/archive`, () => HttpResponse.json({ items: [
      { type: 'project', id: 'a1', name: 'Old project', archived_at: '2026-09-01T10:00:00Z', archived_by: null, can_restore: false },
      { type: 'user', id: 'a2', name: 'Gone Person', username: 'gone', archived_at: '2026-09-02T10:00:00Z', archived_by: null,
        can_restore: false }] })))
    renderAsUser(<ArchivePage />, { user: executive, route: '/archive' })
    expect(await screen.findByText('Gone Person')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restore/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('combobox', { name: /type/i }))
    expect(await screen.findByRole('option', { name: /people/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/read-only/i)).toBeInTheDocument())
  })
})
