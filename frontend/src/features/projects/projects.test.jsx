import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import ProjectDetailPage from './ProjectDetailPage.jsx'
import ProjectsPage from './ProjectsPage.jsx'

const project = (overrides = {}) => ({
  id: 'p1', name: 'Apollo Data Migration', description: 'Move records', status: 'active',
  start_date: '2026-01-01', predicted_end_date: '2026-12-31', budget: 250000, consumed: 50000,
  budget_pct: 20, progress_pct: 33.3, at_risk_reasons: [], is_archived: false, completed_at: null,
  manager: { id: users.manager.id, name: 'Morgan Manager' }, ...overrides,
})

function listHandler(items = [project()], seen = []) {
  return http.get(`${API}/projects`, ({ request }) => {
    seen.push(Object.fromEntries(new URL(request.url).searchParams))
    return HttpResponse.json({ items, total: items.length })
  })
}

const managersHandler = () => http.get(`${API}/users`, () =>
  HttpResponse.json({ items: [{ id: users.manager.id, username: 'manager.demo', first_name: 'Morgan',
    last_name: 'Manager', job_title: 'Delivery Manager', role: 'manager' }], total: 1 }))

function detailHandlers(p = project()) {
  return [
    http.get(`${API}/projects/${p.id}`, () => HttpResponse.json(p)),
    http.get(`${API}/projects/${p.id}/summary`, () => HttpResponse.json({
      project: p, budget: p.budget, consumed: p.consumed, remaining: p.budget - p.consumed,
      budget_pct: p.budget_pct, progress_pct: p.progress_pct, at_risk_reasons: p.at_risk_reasons, member_count: 1 })),
    http.get(`${API}/projects/${p.id}/members`, () => HttpResponse.json([
      { user: { id: 'u-ada', first_name: 'Ada', last_name: 'Lovelace', job_title: 'Analyst', username: 'ada' },
        planned_hours_per_week: 20 }])),
  ]
}

describe('ProjectsPage', () => {
  test('projects filters sync to URL and refetch', async () => {
    const seen = []
    server.use(listHandler([project()], seen), managersHandler())
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects?status=active', path: '/projects' })
    expect(await screen.findByText('Apollo Data Migration')).toBeInTheDocument()
    expect(seen.at(-1)).toMatchObject({ status: 'active' })
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: /search projects/i }), 'apo')
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ q: 'apo', status: 'active' }))
    expect(screen.getByTestId('location')).toHaveTextContent('q=apo')
    await user.click(screen.getByRole('checkbox', { name: /at risk only/i }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ at_risk: 'true' }))
    expect(screen.getByTestId('location')).toHaveTextContent('at_risk=true')
  })

  test('rows show progress, budget use and risk', async () => {
    server.use(listHandler([project({ at_risk_reasons: ['PAST_DUE'] })]), managersHandler())
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    expect(await screen.findByText('Past due date')).toBeInTheDocument()
    expect(screen.getByText('33.3%')).toBeInTheDocument()
    expect(screen.getByText('20% used')).toBeInTheDocument()
  })

  test('empty projects list shows EmptyState with action for admin', async () => {
    server.use(listHandler([]), managersHandler())
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create the first project/i })).toBeInTheDocument()
  })

  test('employee does not see New project or archive actions', async () => {
    server.use(listHandler([]))
    renderAsUser(<ProjectsPage />, { user: users.employee, route: '/projects', path: '/projects' })
    expect(await screen.findByText(/aren't on any projects yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /manager/i })).not.toBeInTheDocument()

    server.use(...detailHandlers())
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByRole('heading', { name: 'Apollo Data Migration' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  test('project form validates end date after start', async () => {
    let posted = null
    server.use(listHandler([]), managersHandler(),
      http.post(`${API}/projects`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(project(), { status: 201 }) }))
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new project/i }))
    const dialog = await screen.findByRole('dialog', { name: /new project/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Orion')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-06-01')
    await user.type(within(dialog).getByLabelText(/predicted end date/i), '2026-05-01')
    await user.click(within(dialog).getByRole('combobox', { name: /manager/i }))
    await user.click(await screen.findByRole('option', { name: /morgan manager/i }))
    await user.click(within(dialog).getByRole('button', { name: /create project/i }))
    expect(await within(dialog).findByText('End date must be on or after the start date')).toBeInTheDocument()
    expect(posted).toBeNull()
    await user.clear(within(dialog).getByLabelText(/predicted end date/i))
    await user.type(within(dialog).getByLabelText(/predicted end date/i), '2026-12-01')
    await user.click(within(dialog).getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(posted).toMatchObject({ name: 'Orion', start_date: '2026-06-01',
      predicted_end_date: '2026-12-01', manager_id: users.manager.id }))
    expect(await screen.findByText('project page p1')).toBeInTheDocument()
  })

  test('server field errors appear next to the field', async () => {
    server.use(listHandler([]), managersHandler(), http.post(`${API}/projects`, () => HttpResponse.json(
      { error: { code: 'CONFLICT', message: 'That name is already taken', details: { name: 'taken' } } }, { status: 409 })))
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new project/i }))
    const dialog = await screen.findByRole('dialog', { name: /new project/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Apollo')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-06-01')
    await user.type(within(dialog).getByLabelText(/predicted end date/i), '2026-07-01')
    await user.click(within(dialog).getByRole('combobox', { name: /manager/i }))
    await user.click(await screen.findByRole('option', { name: /morgan manager/i }))
    await user.click(within(dialog).getByRole('button', { name: /create project/i }))
    expect(await within(dialog).findByText('A project with this name already exists')).toBeInTheDocument()
  })
})

describe('ProjectDetailPage', () => {
  test('tabs are kept in the URL', async () => {
    server.use(...detailHandlers())
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1?tab=budget', path: '/projects/:id' })
    expect(await screen.findByRole('tab', { name: 'Budget', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/\$200,000 remaining/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByTestId('location')).toHaveTextContent('tab=team')
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
  })

  test('team tab shows cap error message with current total', async () => {
    server.use(...detailHandlers(),
      http.get(`${API}/users`, () => HttpResponse.json({ items: [
        { id: 'u-bo', username: 'bo', first_name: 'Bo', last_name: 'Peep', job_title: 'Engineer' }], total: 1 })),
      http.post(`${API}/projects/p1/members`, () => HttpResponse.json({ error: { code: 'PLANNED_HOURS_EXCEEDED',
        message: 'x', details: { current_total: 30, requested: 12, cap: 40 } } }, { status: 400 })))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1?tab=team', path: '/projects/:id' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /add member/i }))
    const dialog = await screen.findByRole('dialog', { name: /add a team member/i })
    await user.click(within(dialog).getByRole('combobox', { name: /person/i }))
    await user.click(await screen.findByRole('option', { name: /bo peep/i }))
    await user.clear(within(dialog).getByLabelText(/planned hours/i))
    await user.type(within(dialog).getByLabelText(/planned hours/i), '12')
    await user.click(within(dialog).getByRole('button', { name: /^add$/i }))
    expect(await within(dialog).findByText('Bo Peep is already planned for 30h of 40h per week.')).toBeInTheDocument()
  })

  test('admin archives with confirmation', async () => {
    let archived = false
    server.use(...detailHandlers(), http.delete(`${API}/projects/p1`, () => { archived = true; return new HttpResponse(null, { status: 204 }) }))
    renderAsUser(<ProjectDetailPage />, { user: users.admin, route: '/projects/p1', path: '/projects/:id' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /^archive$/i }))
    const dialog = await screen.findByRole('dialog', { name: /archive this project/i })
    await user.click(within(dialog).getByRole('button', { name: /^archive$/i }))
    await waitFor(() => expect(archived).toBe(true))
  })
})
