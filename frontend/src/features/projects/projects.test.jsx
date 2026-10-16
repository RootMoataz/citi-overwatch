import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
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

const milestoneCosts = (hoursVisible = true) => ({
  hours_visible: hoursVisible,
  items: [
    { milestone: { id: 'm1', name: 'Schema Mapping', status: 'completed' }, approved_hours: hoursVisible ? 600 : null,
      pending_hours: hoursVisible ? 12 : null, approved_cost: 30000, budget_pct: 12 },
    { milestone: { id: 'm2', name: 'Cutover', status: 'in_progress' }, approved_hours: hoursVisible ? 400 : null,
      pending_hours: hoursVisible ? 0 : null, approved_cost: 20000, budget_pct: 8 }],
  total: { approved_hours: hoursVisible ? 1000 : null, pending_hours: hoursVisible ? 12 : null, approved_cost: 50000, budget_pct: 20 },
})

function detailHandlers(p = project(), costs = milestoneCosts()) {
  return [
    http.get(`${API}/projects/${p.id}/milestone-costs`, () => HttpResponse.json(costs)),
    http.get(`${API}/projects/${p.id}`, () => HttpResponse.json(p)),
    http.get(`${API}/projects/${p.id}/summary`, () => HttpResponse.json({
      project: p, budget: p.budget, consumed: p.consumed, remaining: p.budget - p.consumed,
      budget_pct: p.budget_pct, progress_pct: p.progress_pct, at_risk_reasons: p.at_risk_reasons, member_count: 1 })),
    http.get(`${API}/projects/${p.id}/members`, () => HttpResponse.json([
      { user: { id: 'u-ada', first_name: 'Ada', last_name: 'Lovelace', job_title: 'Analyst', username: 'ada' },
        planned_hours_per_week: 20 }])),
  ]
}

const departmentsHandler = () => http.get(`${API}/departments`, () => HttpResponse.json({ items: [
  { id: 'd1', name: 'Technology', is_archived: false }, { id: 'd2', name: 'Operations', is_archived: false }] }))

describe('ProjectsPage', () => {
  beforeEach(() => server.use(departmentsHandler()))

  test('admin puts a new project in a department and picks pull mode', async () => {
    let posted = null
    server.use(listHandler([]), managersHandler(),
      http.post(`${API}/projects`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(project(), { status: 201 }) }))
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new project/i }))
    const dialog = await screen.findByRole('dialog', { name: /new project/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Orion')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-06-01')
    await user.type(within(dialog).getByLabelText(/predicted end date/i), '2026-12-01')
    await user.click(within(dialog).getByRole('combobox', { name: /manager/i }))
    await user.click(await screen.findByRole('option', { name: /morgan manager/i }))
    expect(within(dialog).getByRole('combobox', { name: /work mode/i })).toHaveTextContent(/push/i)
    await user.click(within(dialog).getByRole('combobox', { name: /department/i }))
    await user.click(await screen.findByRole('option', { name: 'Technology' }))
    await user.click(within(dialog).getByRole('combobox', { name: /work mode/i }))
    await user.click(await screen.findByRole('option', { name: /pull/i }))
    await user.click(within(dialog).getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(posted).toMatchObject({ name: 'Orion', department_id: 'd1', work_mode: 'pull' }))
  }, 15000) // Types a whole form and picks three menus; under a full parallel run it sits just past the 5s default.

  test('a new project in a department with a template starts from it unless the admin unticks it', async () => {
    const posted = []
    server.use(listHandler([]), managersHandler(),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [
        { id: 'd1', name: 'Technology', is_archived: false }, { id: 'd3', name: 'Marketing', is_archived: false }] })),
      http.post(`${API}/projects`, async ({ request }) => { posted.push(await request.json()); return HttpResponse.json(project(), { status: 201 }) }))
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new project/i }))
    const dialog = await screen.findByRole('dialog', { name: /new project/i })
    expect(within(dialog).queryByRole('checkbox', { name: /template/i })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: /department/i }))
    await user.click(await screen.findByRole('option', { name: 'Marketing' }))
    expect(within(dialog).queryByRole('checkbox', { name: /template/i })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: /department/i }))
    await user.click(await screen.findByRole('option', { name: 'Technology' }))
    const box = await within(dialog).findByRole('checkbox', { name: 'Start from the Technology template' })
    expect(box).toBeChecked()
    expect(within(dialog).getByText(/adds 7 milestones/i)).toHaveTextContent(/Discovery & requirements.*Hypercare/)
    await user.type(within(dialog).getByLabelText(/^name/i), 'Orion')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-06-01')
    await user.type(within(dialog).getByLabelText(/predicted end date/i), '2026-12-01')
    await user.click(within(dialog).getByRole('combobox', { name: /manager/i }))
    await user.click(await screen.findByRole('option', { name: /morgan manager/i }))
    await user.click(box)
    expect(box).not.toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ name: 'Orion', department_id: 'd1' })
    expect(posted[0]).not.toHaveProperty('template')
  }, 15000)

  test('the template is sent when the box stays ticked', async () => {
    let posted = null
    server.use(listHandler([]), managersHandler(),
      http.post(`${API}/projects`, async ({ request }) => { posted = await request.json(); return HttpResponse.json(project(), { status: 201 }) }))
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects', path: '/projects' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new project/i }))
    const dialog = await screen.findByRole('dialog', { name: /new project/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Orion')
    await user.type(within(dialog).getByLabelText(/start date/i), '2026-06-01')
    await user.type(within(dialog).getByLabelText(/predicted end date/i), '2026-12-01')
    await user.click(within(dialog).getByRole('combobox', { name: /manager/i }))
    await user.click(await screen.findByRole('option', { name: /morgan manager/i }))
    await user.click(within(dialog).getByRole('combobox', { name: /department/i }))
    await user.click(await screen.findByRole('option', { name: 'Operations' }))
    expect(await within(dialog).findByRole('checkbox', { name: 'Start from the Operations template' })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: /create project/i }))
    await waitFor(() => expect(posted).toMatchObject({ name: 'Orion', department_id: 'd2', template: true }))
  }, 15000)

  describe('the list', () => {
    const rowsOf = () => within(screen.getByRole('table', { name: 'Projects' })).getAllByRole('row').slice(1)
    const counts = { total: 6, active: 3, at_risk: 2 }

    function serve(items = [project()], { seen = [], total = items.length, countsBody = counts, respond } = {}) {
      server.use(managersHandler(), http.get(`${API}/projects`, ({ request }) => {
        const query = Object.fromEntries(new URL(request.url).searchParams)
        seen.push(query)
        if (respond) return respond(query)
        return HttpResponse.json({ items, total, counts: countsBody })
      }))
      return seen
    }
    const go = (user, route = '/projects') => renderAsUser(<ProjectsPage />, { user, route, path: '/projects' })

    afterEach(() => { vi.useRealTimers() })

    test('header: title, subtitle, and the actions for each role', async () => {
      serve()
      go(users.admin)
      expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
      expect(screen.getByText('Keep delivery, budget and risk in view.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Request a project' })).not.toBeInTheDocument()
    })

    test('a manager gets Request a project, linking to the request dialog, and no New project', async () => {
      serve()
      go(users.manager)
      const link = await screen.findByRole('link', { name: 'Request a project' })
      expect(link).toHaveAttribute('href', '/requests?new=1')
      expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
    })

    test('the KPI strip shows the counts and At risk turns the filter on', async () => {
      const seen = serve()
      go(users.admin)
      const strip = await screen.findByRole('group', { name: 'Projects summary' })
      await waitFor(() => expect(strip).toHaveTextContent('6projects'))
      expect(strip).toHaveTextContent('3active')
      expect(strip).toHaveTextContent('2at risk')
      await userEvent.setup().click(within(strip).getByRole('button', { name: '2 at risk' }))
      expect(screen.getByTestId('location')).toHaveTextContent('at_risk=true')
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ at_risk: 'true' }))
    })

    test('filters set and clear URL params, and every refetch sends them', async () => {
      const seen = serve([project()])
      server.use(departmentsHandler())
      go(users.admin, '/projects?department=d1')
      expect(await screen.findByRole('link', { name: 'Apollo Data Migration' })).toBeInTheDocument()
      expect(seen.at(-1)).toMatchObject({ department: 'd1', sort: 'name', dir: 'asc', page_size: '25' })
      const user = userEvent.setup()

      await user.type(screen.getByRole('textbox', { name: 'Search projects' }), 'apo')
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ q: 'apo', department: 'd1' }))
      expect(screen.getByTestId('location')).toHaveTextContent('q=apo')

      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      await user.click(await screen.findByRole('option', { name: 'Active' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'active' }))
      expect(screen.getByTestId('location')).toHaveTextContent('status=active')

      await user.click(screen.getByRole('switch', { name: 'At risk only' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ at_risk: 'true' }))
      await user.click(screen.getByRole('switch', { name: 'At risk only' }))
      expect(screen.getByTestId('location')).not.toHaveTextContent('at_risk')

      await user.click(screen.getByRole('switch', { name: 'Archived' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ archived: 'true' }))

      await user.click(screen.getByRole('combobox', { name: 'Manager' }))
      await user.click(await screen.findByRole('option', { name: 'Morgan Manager' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ manager: users.manager.id }))

      const chip = await screen.findByRole('button', { name: 'Department: Technology' })
      chip.focus()
      await user.keyboard('{Delete}')
      await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('department'))
      expect(screen.getByTestId('location')).not.toHaveTextContent('department')
    })

    test('sorting is on the server: the header sets sort and dir, and rows keep the server order', async () => {
      const a = project({ id: 'p1', name: 'Zulu' })
      const b = project({ id: 'p2', name: 'Alpha' })
      const seen = serve([a, b])
      go(users.admin)
      await screen.findByRole('link', { name: 'Zulu' })
      expect(screen.getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'ascending')
      expect(rowsOf()[0]).toHaveTextContent('Zulu')    // not re-sorted on the client
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Budget used' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ sort: 'budget_used', dir: 'asc' }))
      expect(screen.getByRole('columnheader', { name: 'Budget used' })).toHaveAttribute('aria-sort', 'ascending')
      await user.click(screen.getByRole('button', { name: 'Budget used' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ sort: 'budget_used', dir: 'desc' }))
      expect(screen.getByTestId('location')).toHaveTextContent('sort=budget_used&dir=desc')
      expect(rowsOf()[0]).toHaveTextContent('Zulu')
    })

    test('paging: 25 per page, the next page is page=2, and a filter change returns to page 1', async () => {
      const seen = serve([project()], { total: 30 })
      go(users.admin, '/projects?status=planned')
      await screen.findByRole('link', { name: 'Apollo Data Migration' })
      expect(seen.at(-1)).toMatchObject({ page_size: '25' })
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /next page/i }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ page: '2', page_size: '25' }))
      expect(screen.getByTestId('location')).toHaveTextContent('page=2')

      await user.click(screen.getByRole('combobox', { name: 'Status' }))
      await user.click(await screen.findByRole('option', { name: 'Active' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ status: 'active' }))
      expect(seen.at(-1).page).not.toBe('2')
      expect(screen.getByTestId('location')).not.toHaveTextContent('page=')
    })

    test('changing the sort on a later page drops the page too', async () => {
      const seen = serve([project()], { total: 30 })
      go(users.admin, '/projects?page=2')
      await screen.findByRole('link', { name: 'Apollo Data Migration' })
      expect(seen.at(-1)).toMatchObject({ page: '2' })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Progress' }))
      await waitFor(() => expect(seen.at(-1)).toMatchObject({ sort: 'progress' }))
      expect(seen.at(-1).page).not.toBe('2')
      expect(screen.getByTestId('location')).not.toHaveTextContent('page=')
    })

    test('rows: name link with the department under it, the archived chip, and a click on the row opens it', async () => {
      serve([project({ department: { id: 'd1', name: 'Technology' }, is_archived: true })])
      go(users.admin)
      const link = await screen.findByRole('link', { name: 'Apollo Data Migration' })
      expect(link).toHaveAttribute('href', '/projects/p1')
      expect(rowsOf()[0]).toHaveTextContent('Technology')
      expect(within(rowsOf()[0]).getByText('Archived')).toBeInTheDocument()
      await userEvent.setup().click(within(rowsOf()[0]).getByText('Technology'))
      expect(await screen.findByText('project page p1')).toBeInTheDocument()
    })

    test('rows: risk in words with its reasons, a healthy row reads No risk, and the due line', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
      serve([
        project({ id: 'p1', name: 'Late One', predicted_end_date: '2026-10-12', budget_pct: 81.2, progress_pct: 61.9,
          at_risk_reasons: ['BUDGET_BURN', 'PAST_DUE'] }),
        project({ id: 'p2', name: 'Fine One', predicted_end_date: '2026-10-23' }),
      ])
      go(users.admin)
      await screen.findByRole('link', { name: 'Late One' })
      const [late, fine] = rowsOf()
      const risk = within(late).getByRole('img', { name: 'Risk: Past due, Budget ahead of progress' })
      expect(risk).toHaveTextContent('Past due')
      expect(within(late).getByText('3 days overdue')).toBeInTheDocument()
      expect(within(fine).getByRole('img', { name: 'No risk' })).toHaveTextContent('—')
      expect(within(fine).getByText('8 days left')).toBeInTheDocument()
      await userEvent.setup({ advanceTimers: () => {} }).hover(risk)
      expect(await screen.findByText("Ended Oct 12, 2026, 3 days ago, and isn't completed.")).toBeInTheDocument()
      expect(screen.getByText('81% of the budget used against 62% progress: 19 points ahead.')).toBeInTheDocument()
    })

    test('rows: manager, status, and the progress and budget bars', async () => {
      serve([project({ progress_pct: 33.3, budget_pct: 95 })])
      go(users.admin)
      await screen.findByRole('link', { name: 'Apollo Data Migration' })
      expect(screen.getByRole('link', { name: 'Morgan Manager' })).toBeInTheDocument()
      expect(screen.getByRole('meter', { name: 'Apollo Data Migration progress' })).toHaveAttribute('aria-valuetext', '33.3%')
      expect(screen.getByRole('meter', { name: 'Apollo Data Migration budget used' })).toHaveAttribute('aria-valuetext', '95%')
      for (const name of ['Project', 'Status', 'Manager', 'Progress', 'Budget used', 'Due date', 'Risk']) {
        expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
      }
    })

    test('footer: the New York date and the explanation', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
      serve()
      go(users.admin)
      expect(await screen.findByText('Today is October 15, 2026')).toBeInTheDocument()
      expect(screen.getByText(/Progress is milestone completion weighted by difficulty\. Budget used is approved spend against the budget\./))
        .toBeInTheDocument()
    })

    test('late evening in New York: the footer reads the New York date and a project ending today is Due today', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-16T02:00:00Z'))
      serve([project({ predicted_end_date: '2026-10-15' })])
      go(users.admin)
      expect(await screen.findByText('Today is October 15, 2026')).toBeInTheDocument()
      expect(await screen.findByText('Due today')).toBeInTheDocument()
    })

    test('an employee gets the table but no New project, Request a project, All managers or Archived', async () => {
      serve()
      go(users.employee)
      await screen.findByRole('link', { name: 'Apollo Data Migration' })
      expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Request a project' })).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Manager' })).not.toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Archived' })).not.toBeInTheDocument()
    })

    test('loading shows skeleton rows', async () => {
      serve([project()], { respond: async () => { await new Promise((r) => setTimeout(r, 300)); return HttpResponse.json({ items: [], total: 0, counts }) } })
      const { container } = go(users.admin)
      const table = await screen.findByRole('table', { name: 'Projects' })
      expect(table.closest('[aria-busy="true"]')).not.toBeNull()
      expect(container.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0)
    })

    test('an error shows the alert with Retry, and Retry loads the list', async () => {
      let fail = true
      serve([project()], { respond: () => (fail
        ? HttpResponse.json({ error: { code: 'INTERNAL', message: 'Boom' } }, { status: 500 })
        : HttpResponse.json({ items: [project()], total: 1, counts })) })
      go(users.admin)
      const alert = await screen.findByRole('alert')
      fail = false
      await userEvent.setup().click(within(alert).getByRole('button', { name: /try again|retry/i }))
      expect(await screen.findByRole('link', { name: 'Apollo Data Migration' })).toBeInTheDocument()
    })

    test('filtered with no rows says No projects match and Clear filters clears them', async () => {
      const seen = serve([], { respond: (q) => HttpResponse.json({ items: q.status ? [] : [project()], total: q.status ? 0 : 1, counts }) })
      go(users.admin, '/projects?status=on_hold')
      expect(await screen.findByText('No projects match')).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(await screen.findByRole('link', { name: 'Apollo Data Migration' })).toBeInTheDocument()
      expect(seen.at(-1)).not.toHaveProperty('status')
    })

    test('no projects at all shows the empty state for the role', async () => {
      serve([], { countsBody: { total: 0, active: 0, at_risk: 0 } })
      go(users.admin)
      expect(await screen.findByText('No projects yet')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create the first project/i })).toBeInTheDocument()
      serve([], { countsBody: { total: 0, active: 0, at_risk: 0 } })
      go(users.employee)
      expect(await screen.findByText(/aren't on any projects yet/i)).toBeInTheDocument()
    })

    test('phones: cards instead of a table, with name, status, risk, both bars and the due line; the KPI strip keeps 3 values', async () => {
      setViewport(375)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
      serve([project({ predicted_end_date: '2026-10-12', at_risk_reasons: ['PAST_DUE'], department: { id: 'd1', name: 'Technology' } })])
      go(users.admin)
      const list = await screen.findByRole('list', { name: 'Projects' })
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      const card = within(list).getByRole('listitem')
      expect(card).toHaveTextContent('Apollo Data Migration')
      expect(card).toHaveTextContent('Technology')
      expect(within(card).getByText('Active')).toBeInTheDocument()
      expect(within(card).getByRole('img', { name: 'Risk: Past due' })).toBeInTheDocument()
      expect(within(card).getByRole('meter', { name: 'Apollo Data Migration progress' })).toHaveAttribute('aria-valuetext', '33.3%')
      expect(within(card).getByRole('meter', { name: 'Apollo Data Migration budget used' })).toHaveAttribute('aria-valuetext', '20%')
      expect(within(card).getByText('3 days overdue')).toBeInTheDocument()
      const strip = screen.getByRole('group', { name: 'Projects summary' })
      await waitFor(() => expect(strip).toHaveTextContent('6projects'))
      expect(strip).toHaveTextContent('3active')
      expect(strip).toHaveTextContent('2at risk')
    })
  })

  test('an employee sees no archive or edit actions on a project page', async () => {
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
  beforeEach(() => server.use(departmentsHandler()))

  test('overview shows the department and the work mode', async () => {
    server.use(...detailHandlers(project({ department: { id: 'd1', name: 'Technology' }, work_mode: 'pull' })))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByText(/department: technology/i)).toBeInTheDocument()
    expect(screen.getByText(/pull mode/i)).toBeInTheDocument()
    expect(screen.getByText(/^manager:/i)).toHaveTextContent('Manager: MMMorgan Manager')
  })

  test('overview shows the estimated effort over the project days and how much is used', async () => {
    server.use(...detailHandlers(project({ total_estimated_hours: 640, duration_days: 120, working_days: 86,
      logged_hours: 333, estimate_used_pct: 52 })))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByText('Estimated effort')).toBeInTheDocument()
    expect(await screen.findByText('over 120 days · 52% used')).toBeInTheDocument()
  })

  test('team tab rows show each person with an avatar', async () => {
    server.use(...detailHandlers())
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1?tab=team', path: '/projects/:id' })
    const list = await screen.findByRole('list', { name: /team members/i })
    expect(await within(list).findByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(list).getByText('AL')).toBeInTheDocument()
    expect(within(list).queryByRole('link', { name: 'Ada Lovelace' })).not.toBeInTheDocument()   // a teammate: plain text
  })

  test("the project's manager opens a team member's profile from the team tab", async () => {
    server.use(...detailHandlers(), http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1?tab=team', path: '/projects/:id' })
    const list = await screen.findByRole('list', { name: /team members/i })
    expect(await within(list).findByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
  })

  test('the manager moves the project to another department and back to push mode', async () => {
    let put = null
    server.use(...detailHandlers(project({ department: { id: 'd1', name: 'Technology' }, work_mode: 'pull' })),
      http.put(`${API}/projects/p1`, async ({ request }) => { put = await request.json(); return HttpResponse.json(project()) }))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1', path: '/projects/:id' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit project/i })
    await user.click(await within(dialog).findByRole('combobox', { name: /department/i }))
    await user.click(await screen.findByRole('option', { name: 'Operations' }))
    await user.click(within(dialog).getByRole('combobox', { name: /work mode/i }))
    await user.click(await screen.findByRole('option', { name: /push/i }))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(put).toMatchObject({ department_id: 'd2', work_mode: 'push' }))
  })

  test('tabs are kept in the URL', async () => {
    server.use(...detailHandlers())
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1?tab=budget', path: '/projects/:id' })
    expect(await screen.findByRole('tab', { name: 'Budget', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/\$200,000 remaining/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByTestId('location')).toHaveTextContent('tab=team')
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
  })

  test('budget tab lists cost by milestone with a total that matches consumed', async () => {
    server.use(...detailHandlers())
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1?tab=budget', path: '/projects/:id' })
    const table = await screen.findByRole('table', { name: /cost by milestone/i })
    expect(within(table).getByRole('columnheader', { name: 'Pending hours' })).toBeInTheDocument()
    const row = within(table).getByRole('rowheader', { name: /schema mapping/i }).closest('tr')
    expect(within(row).getByText('600h')).toBeInTheDocument()
    expect(within(row).getByText('$30,000')).toBeInTheDocument()
    expect(within(row).getByText('12%')).toBeInTheDocument()
    const total = within(table).getByRole('rowheader', { name: /total/i }).closest('tr')
    expect(within(total).getByText('$50,000')).toBeInTheDocument()
    expect(screen.getAllByText('$50,000')).toHaveLength(2)                 // the Consumed tile and the total row
    expect(screen.queryByText(/hourly rate:/i)).not.toBeInTheDocument()
    const bullet = screen.getByRole('list', { name: /consumed against budget/i })
    expect(within(bullet).getByRole('listitem')).toHaveAccessibleName(/^Budget \$250,000\. Consumed \$50,000 \(20%\)/)
    expect(within(row).getByRole('meter', { name: /schema mapping share of budget/i })).toHaveAttribute('aria-valuenow', '12')
  })

  describe('cost by milestone bars', () => {
    const fillWidth = (meter) => parseFloat(getComputedStyle(meter.firstChild).width)

    async function costTable() {
      server.use(...detailHandlers())
      renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1?tab=budget', path: '/projects/:id' })
      return screen.findByRole('table', { name: /cost by milestone/i })
    }

    test("the most expensive milestone's bar is full and the others are relative", async () => {
      const table = await costTable()
      const big = within(table).getByRole('meter', { name: /schema mapping share of budget/i })
      const small = within(table).getByRole('meter', { name: /cutover share of budget/i })
      expect(big).toHaveAttribute('aria-valuemax', '12')
      expect(small).toHaveAttribute('aria-valuemax', '12')
      expect(fillWidth(big)).toBeCloseTo(100, 1)
      expect(fillWidth(small)).toBeCloseTo((8 / 12) * 100, 1)
    })

    test('the percent text is the share of the budget', async () => {
      const table = await costTable()
      const small = within(table).getByRole('meter', { name: /cutover share of budget/i })
      expect(small).toHaveAttribute('aria-valuenow', '8')
      expect(small).toHaveAttribute('aria-valuetext', '8%')
      expect(within(small.closest('tr')).getByText('8%')).toBeInTheDocument()
    })

    test('the caption explains the bars', async () => {
      await costTable()
      expect(screen.getByText(/the most expensive milestone fills its bar/i)).toBeInTheDocument()
    })
  })

  test('budget tab hides milestone hours from employees but keeps the costs', async () => {
    server.use(...detailHandlers(project(), milestoneCosts(false)))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1?tab=budget', path: '/projects/:id' })
    const table = await screen.findByRole('table', { name: /cost by milestone/i })
    expect(within(table).queryByRole('columnheader', { name: /hours/i })).not.toBeInTheDocument()
    expect(within(table).getByText('$20,000')).toBeInTheDocument()
    expect(screen.getByText(/only the project.s manager and admins see the hours/i)).toBeInTheDocument()
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

  test('overview says progress is weighted by difficulty', async () => {
    server.use(...detailHandlers())
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1', path: '/projects/:id' })
    const tile = (await screen.findByText('Progress')).parentElement
    expect(within(tile).getByText('33.3%')).toBeInTheDocument()
    expect(within(tile).getByText(/milestones done, weighted by difficulty/i)).toBeInTheDocument()
  })
})
