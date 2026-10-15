import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, onTestFinished, test } from 'vitest'
import { API, HttpResponse, delay, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import NotificationBell from '../../components/NotificationBell.jsx'
import ProjectDetailPage from '../projects/ProjectDetailPage.jsx'
import PlanTab from './PlanTab.jsx'

const project = {
  id: 'p1', name: 'Beacon', start_date: '2026-01-01', predicted_end_date: '2026-12-31', status: 'planned',
  plan_finalized_at: null, manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [],
  work_mode: 'push', is_archived: false,
}
const eli = { id: users.employee.id, name: 'Eli Employee' }

const ms = (id, name, column, sequence, extra = {}) => ({
  id, name, project_id: 'p1', description: '', status: 'not_started', display_status: 'not_started', blocked: false,
  predecessors: [], assignees: [eli], is_assignee: false, completed_at: null, is_archived: false, difficulty: 'medium',
  priority: 'medium', start_date: '2026-02-01', end_date: '2026-03-01', plan_column: column, sequence, ...extra,
})

const design = ms('m1', 'Design', 'scheduled', 1, { assignees: [], priority: 'high' })
const build = ms('m2', 'Build', 'scheduled', 2, { predecessors: ['m1'], required_skills: ['React', { name: 'Figma' }] })
const research = ms('m3', 'User Research', 'backlog', 1, { difficulty: 'easy' })
const sync = ms('m4', 'Offline Sync', 'ready', 1, { priority: 'critical' })

const failingChecks = [
  { code: 'HAS_SCHEDULED', label: 'At least one milestone is scheduled', ok: true, problems: [] },
  { code: 'ALL_SCHEDULED', label: 'Nothing is left in Backlog or Ready', ok: false,
    problems: [{ milestone_id: 'm3', name: 'User Research', message: 'User Research is still in Backlog' }] },
  { code: 'HAS_ASSIGNEE', label: 'Every scheduled milestone has someone assigned', ok: false,
    problems: [{ milestone_id: 'm1', name: 'Design', message: 'Nobody is assigned to Design' }] },
]
const passingChecks = failingChecks.map((c) => ({ ...c, ok: true, problems: [] }))

function handlers({ list = [design, build, research, sync], plan = {}, extra = [] } = {}) {
  return [
    ...extra,
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json(list)),
    http.get(`${API}/projects/p1/plan`, () => HttpResponse.json({
      project_id: 'p1', status: 'planned', plan_finalized_at: null, editable: true, ready: false, checks: failingChecks, ...plan })),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([
      { user: { id: eli.id, first_name: 'Eli', last_name: 'Employee', job_title: 'Engineer', username: 'eli' }, planned_hours_per_week: 30 }])),
  ]
}

const renderTab = (user, { manage = true, p = project } = {}) =>
  renderAsUser(<PlanTab project={p} manage={manage} user={user} />, { user, route: '/plan-under-test' })

const column = (name) => screen.getByRole('region', { name })
const cardIn = async (columnName, cardName) => {
  await screen.findByRole('heading', { name: cardName, level: 3 })
  return within(column(columnName)).getByRole('heading', { name: cardName, level: 3 }).closest('[data-card]')
}
const openActions = async (name) => userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }))

describe('PlanTab', () => {
  test('shows each card in its column, in order, with what it needs', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    const scheduled = await cardIn('Scheduled', 'Build')
    expect(within(column('Scheduled')).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Design', 'Build'])
    await cardIn('Backlog', 'User Research')
    await cardIn('Ready', 'Offline Sync')
    expect(within(scheduled).getByText('After Design')).toBeInTheDocument()
    expect(within(scheduled).getByText('Due Mar 1, 2026')).toBeInTheDocument()
    expect(within(scheduled).getByLabelText('Required skills')).toHaveTextContent('ReactFigma')
    const designCard = await cardIn('Scheduled', 'Design')
    expect(within(designCard).getByText('Nobody assigned')).toBeInTheDocument()
    expect(within(designCard).getByRole('img', { name: /problems: nobody assigned yet/i })).toBeInTheDocument()
    expect(within(designCard).getByLabelText('Priority: High')).toBeInTheDocument()
    expect(within(designCard).queryByLabelText('Required skills')).not.toBeInTheDocument()
    expect(await screen.findByText('2 of 3 checks to fix')).toBeInTheDocument()
  })

  test('team members see the plan read-only', async () => {
    server.use(...handlers({ plan: { editable: false } }))
    renderTab(users.employee, { manage: false })
    await cardIn('Scheduled', 'Design')
    expect(await screen.findByText(/Morgan Manager is still planning this project/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^move /i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /finalize plan/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a card/i })).not.toBeInTheDocument()
  })

  test('"Move to…" moves a card at once and saves the whole board', async () => {
    const saved = []
    server.use(...handlers({ extra: [http.put(`${API}/projects/p1/plan/order`, async ({ request }) => {
      saved.push((await request.json()).items)
      await delay(50)
      return HttpResponse.json([design, build, { ...research, plan_column: 'scheduled', sequence: 3 }, sync])
    })] }))
    renderTab(users.manager)
    await openActions('User Research')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Scheduled' }))
    expect(await cardIn('Scheduled', 'User Research')).toBeInTheDocument()  // before the server answers
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toEqual([
      { milestone_id: 'm4', plan_column: 'ready', sequence: 1 },
      { milestone_id: 'm1', plan_column: 'scheduled', sequence: 1 },
      { milestone_id: 'm2', plan_column: 'scheduled', sequence: 2 },
      { milestone_id: 'm3', plan_column: 'scheduled', sequence: 3 },
    ])
  })

  test('a move the server refuses jumps back', async () => {
    server.use(...handlers({ extra: [http.put(`${API}/projects/p1/plan/order`, async () => {
      await delay(30)
      return HttpResponse.json({ error: { code: 'PLAN_FINALIZED', message: 'This plan is already finalized' } }, { status: 409 })
    })] }))
    renderTab(users.manager)
    await openActions('Build')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Up one place' }))
    await waitFor(() => expect(within(column('Scheduled')).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Build'))
    await waitFor(() => expect(within(column('Scheduled')).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Design'))
  })

  test('cards can be picked up from the keyboard, with spoken feedback', async () => {
    server.use(...handlers())
    const scroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = () => {}  // jsdom has no layout; dnd-kit scrolls the lifted card into view
    onTestFinished(() => { Element.prototype.scrollIntoView = scroll })
    renderTab(users.manager)
    const handle = await screen.findByRole('button', { name: 'Move Build' })
    expect(handle).toHaveAttribute('aria-roledescription', 'draggable card')
    expect(handle).toHaveAttribute('aria-describedby')
    handle.focus()
    await userEvent.keyboard(' ')
    const live = () => [...document.querySelectorAll('[aria-live]')].map((n) => n.textContent).join(' | ')
    // jsdom has no layout, so where the lifted card lands first is arbitrary; what matters is that it's announced.
    await waitFor(() => expect(live()).toMatch(/^(Picked up Build\.|Build is over )/))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(live()).toBe("Moving Build was cancelled; it's back where it was."))
    expect(await cardIn('Scheduled', 'Build')).toBeInTheDocument()
  })

  test('sets priority and archives from the card menu', async () => {
    const calls = []
    server.use(...handlers({ extra: [
      http.put(`${API}/milestones/:id`, async ({ params, request }) => {
        calls.push(['PUT', params.id, await request.json()])
        return HttpResponse.json({ ...sync, priority: 'low' })
      }),
      http.delete(`${API}/milestones/:id`, ({ params }) => { calls.push(['DELETE', params.id]); return new HttpResponse(null, { status: 204 }) }),
    ] }))
    renderTab(users.manager)
    await openActions('Offline Sync')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Low' }))
    await waitFor(() => expect(calls).toEqual([['PUT', 'm4', { priority: 'low' }]]))
    await openActions('Offline Sync')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive…' }))
    const confirm = await screen.findByRole('dialog', { name: 'Archive Offline Sync?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(calls[1]).toEqual(['DELETE', 'm4']))
  })

  test('quick add creates a card in its column and opens it for editing', async () => {
    const calls = []
    const fresh = ms('m9', 'Analytics', 'scheduled', 3, { assignees: [], start_date: '2026-01-01', end_date: '2026-12-31' })
    server.use(...handlers({ extra: [
      http.post(`${API}/projects/p1/milestones`, async ({ request }) => {
        calls.push(['POST', await request.json()])
        return HttpResponse.json(fresh, { status: 201 })
      }),
      http.put(`${API}/projects/p1/plan/order`, async ({ request }) => {
        calls.push(['PUT', (await request.json()).items])
        return HttpResponse.json([design, build, research, sync, { ...fresh, plan_column: 'ready', sequence: 2 }])
      }),
    ] }))
    renderTab(users.manager)
    await cardIn('Ready', 'Offline Sync')
    await userEvent.click(within(column('Ready')).getByRole('button', { name: 'Add a card' }))
    await userEvent.type(within(column('Ready')).getByLabelText('New card in Ready'), 'Analytics{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Edit milestone' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Analytics')
    expect(calls).toEqual([
      ['POST', { name: 'Analytics', start_date: '2026-01-01', end_date: '2026-12-31' }],
      ['PUT', [{ milestone_id: 'm9', plan_column: 'ready', sequence: 2 }]],
    ])
  })

  test('finalize shows the failing checks and stays disabled', async () => {
    server.use(...handlers())
    renderTab(users.manager)
    await userEvent.click(await screen.findByRole('button', { name: 'Finalize plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Finalize the plan for Beacon?' })
    expect(await within(dialog).findByText('User Research is still in Backlog')).toBeInTheDocument()
    expect(within(dialog).getByText('Nobody is assigned to Design')).toBeInTheDocument()
    expect(within(dialog).getByText(/2 checks need fixing/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Finalize and start the project' })).toBeDisabled()
  })

  test('a passing plan finalizes and opens the Milestones tab', async () => {
    const posted = []
    server.use(...handlers({ list: [{ ...design, assignees: [eli] }, build], plan: { ready: true, checks: passingChecks },
      extra: [http.post(`${API}/projects/p1/plan/finalize`, () => {
        posted.push(true)
        return HttpResponse.json({ project: { ...project, status: 'active', plan_finalized_at: '2026-10-15T10:00:00Z' },
          first_milestone: { id: 'm1', name: 'Design' } })
      })] }))
    renderTab(users.manager)
    expect(await screen.findByText('Ready to finalize')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Finalize plan' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/everything checks out/i)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finalize and start the project' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tab=milestones'))
    expect(posted).toEqual([true])
  })

  test('a finalize the server refuses shows its checks', async () => {
    server.use(...handlers({ plan: { ready: true, checks: passingChecks }, extra: [
      http.post(`${API}/projects/p1/plan/finalize`, () => HttpResponse.json({ error: {
        code: 'PLAN_INVALID', message: "The plan isn't ready to finalize yet", details: { checks: failingChecks } } }, { status: 422 }))] }))
    renderTab(users.manager)
    await userEvent.click(await screen.findByRole('button', { name: 'Finalize plan' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Finalize and start the project' }))
    expect(await within(dialog).findByText('Nobody is assigned to Design')).toBeInTheDocument()
  })

  test('a finalized plan is read-only and says when it was finalized', async () => {
    const done = { ...project, status: 'active', plan_finalized_at: '2026-10-15T10:00:00Z' }
    server.use(...handlers({ plan: { status: 'active', plan_finalized_at: done.plan_finalized_at, editable: false } }))
    renderTab(users.manager, { p: done })
    expect(await screen.findByText(/Plan finalized on Oct 15, 2026/)).toBeInTheDocument()
    await cardIn('Scheduled', 'Design')
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalize plan' })).not.toBeInTheDocument()
  })
})

test('the "plan finalized" alert opens the project\'s milestones', async () => {
  server.use(
    http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n1', type: 'PLAN_FINALIZED', week_start: null,
      read_at: null, subject_user: { id: users.manager.id, name: 'Morgan Manager' },
      payload: { project: { id: 'p1', name: 'Beacon' }, milestone: { id: 'm1', name: 'Design' }, assigned: true },
      message: 'Beacon plan finalized: your first milestone is Design' }])),
    http.post(`${API}/notifications/:id/read`, () => HttpResponse.json({ id: 'n1', read: true })))
  renderAsUser(<NotificationBell />, { user: users.employee })
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
  await userEvent.click(await screen.findByText('Beacon plan finalized: your first milestone is Design'))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/p1?tab=milestones'))
})

describe('Plan tab on the project page', () => {
  const page = (p) => [
    http.get(`${API}/projects/p1`, () => HttpResponse.json(p)),
    ...handlers({ plan: { editable: false } }),
  ]

  test('a project in planning opens on its Plan tab', async () => {
    server.use(...page(project))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByRole('tab', { name: 'Plan', selected: true })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Planning board' })).toBeInTheDocument()
  })

  test('a project that never planned on the board has no Plan tab', async () => {
    server.use(...page({ ...project, status: 'active' }), http.get(`${API}/projects/p1/summary`, () => HttpResponse.json({})))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1?tab=plan', path: '/projects/:id' })
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Plan' })).not.toBeInTheDocument()
  })
})
