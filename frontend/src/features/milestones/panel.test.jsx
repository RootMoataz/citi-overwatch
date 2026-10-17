import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNavigate } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import { BreadcrumbProvider, useBreadcrumb, useCrumbLabel } from '../../app/breadcrumbs.js'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { setViewport } from '../../test/setup.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { projectView } from '../projects/viewer.js'
import MilestonesTab from './MilestonesTab.jsx'

const project = {
  id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31', status: 'active',
  manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [],
}
const me = { id: users.employee.id, name: 'Eli Employee' }
const ada = { id: 'u-ada', name: 'Ada Lovelace' }
const qa = { id: 's1', name: 'QA' }

const ms = (overrides) => ({
  project_id: 'p1', description: '', status: 'in_progress', display_status: 'in_progress', blocked: false,
  predecessors: [], assignees: [me], is_assignee: true, completed_at: null, is_archived: false, difficulty: 'medium',
  priority: 'medium', objective: '', completion_criteria: '', required_skills: [], progress_percent: null,
  open_kickback: null, can_post_update: true, can_kick_back: true, can_resolve_kickback: false, can_claim: false,
  start_date: '2026-03-01', end_date: '2026-06-30', logged_hours: 4, estimated_hours: 10,
  ...overrides,
})
const discovery = ms({ id: 'm0', name: 'Discovery', status: 'completed', display_status: 'completed', is_assignee: false,
  assignees: [] })
const mapping = ms({ id: 'm1', name: 'Schema Mapping', objective: 'Map every legacy field', predecessors: ['m0'],
  completion_criteria: 'Customer tables mapped\nAddresses split', required_skills: [qa], priority: 'high',
  difficulty: 'hard', assignees: [me, ada], supporting_ids: [ada.id] })

const kickback = {
  id: 'k1', category: 'unclear_requirement', category_label: 'Unclear requirement',
  reason: 'The address format is not specified anywhere.', raised_at: new Date().toISOString(),
  raised_by: me, resolution: null, resolution_note: null, resolved_at: null, resolved_by: null,
}

let approvalRequests
function handlers(list, extra = []) {
  approvalRequests = 0
  return [
    ...extra,
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json(list)),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])),
    http.get(`${API}/milestones/:id/notes`, () => HttpResponse.json([])),
    http.get(`${API}/milestones/:id/updates`, () => HttpResponse.json([])),
    http.get(`${API}/milestones/:id/history`, () => HttpResponse.json({ kickbacks: [], events: [] })),
    http.get(`${API}/milestones/:id/discussion`, () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'none' } }, { status: 404 })),
    http.get(`${API}/approvals`, () => { approvalRequests += 1; return HttpResponse.json([]) }),
    http.get(`${API}/skills`, () => HttpResponse.json({ items: [qa] })),
    http.get(`${API}/users/:id/profile`, () => HttpResponse.json({ projects: [], milestones: [] })),
  ]
}

function renderTab(user, route) {
  const view = projectView(user, project)
  return renderAsUser(<MilestonesTab project={project} manage={view.manage} user={user} view={view} />,
    { user, route: `/m${route}` })
}
/** The tab after another page ('/before'), with the browser's Back button. */
function renderWithBack(user) {
  function Back() {
    const navigate = useNavigate()
    return <button type="button" onClick={() => navigate(-1)}>Back</button>
  }
  const view = projectView(user, project)
  return renderAsUser(<><MilestonesTab project={project} manage={view.manage} user={user} view={view} /><Back /></>,
    { user, entries: ['/before', '/m'] })
}
const card = (name) => screen.findByRole('complementary', { name })
const location = () => screen.getByTestId('location')
const tabNames = (c) => within(c).getAllByRole('tab').map((t) => t.textContent)

describe('panel tabs', () => {
  test('a manager sees six tabs, each with aria-controls', async () => {
    server.use(...handlers([discovery, mapping]))
    renderTab(users.manager, '?milestone=m1')
    const c = await card('Schema Mapping')
    expect(tabNames(c)).toEqual(['Details', 'Approvals', 'Discussion', 'Work log', 'History', 'Notes'])
    within(c).getAllByRole('tab').forEach((t) => {
      const id = t.getAttribute('aria-controls')
      expect(id).toBeTruthy()
    })
    expect(within(c).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(within(c).getByRole('tabpanel')).toHaveAttribute('id', within(c).getByRole('tab', { name: 'Details' }).getAttribute('aria-controls'))
    // Compact, so all six fit the panel at its desktop width (it still scrolls where they can't), at 44 px tall.
    within(c).getAllByRole('tab').forEach((t) => {
      expect(getComputedStyle(t).minWidth).toBe('0px')
      expect(getComputedStyle(t).paddingLeft).toBe('10px')
      expect(getComputedStyle(t).minHeight).toBe('44px')
    })
  })

  test('phones: the tabs swipe with no scroll arrows, so none hides History or Notes', async () => {
    setViewport(375)
    server.use(...handlers([discovery, mapping]))
    renderTab(users.manager, '?milestone=m1')
    const dialog = await screen.findByRole('dialog', { name: 'Schema Mapping' })
    expect(within(dialog).getByRole('tablist').closest('.MuiTabs-root').querySelector('.MuiTabs-scrollButtons')).toBeNull()
    expect(within(dialog).getByRole('tab', { name: 'Notes' })).toBeInTheDocument()
  })

  test.each([['employee', users.employee], ['executive', users.executive]])('an %s has no Approvals tab', async (_, user) => {
    server.use(...handlers([discovery, mapping]))
    renderTab(user, '?milestone=m1')
    const c = await card('Schema Mapping')
    expect(tabNames(c)).toEqual(['Details', 'Discussion', 'Work log', 'History', 'Notes'])
  })

  test('?panel=history opens History, and clicking a tab sets ?panel=', async () => {
    server.use(...handlers([discovery, mapping]))
    renderTab(users.employee, '?milestone=m1&panel=history')
    const c = await card('Schema Mapping')
    expect(within(c).getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(within(c).getByRole('tab', { name: 'Notes' }))
    expect(location()).toHaveTextContent('panel=notes')
    expect(location()).toHaveTextContent('milestone=m1')
    expect(within(c).getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  })

  test.each([
    ['an employee opening ?panel=approvals', users.employee, 'approvals'],
    ['an executive opening ?panel=approvals', users.executive, 'approvals'],
    ['an employee opening a typo', users.employee, 'nonsense'],
    ['a manager opening a typo', users.manager, 'nonsense'],
  ])('%s sees Details, and only someone who decides hours asks for approvals', async (_, user, value) => {
    server.use(...handlers([discovery, mapping]))
    renderTab(user, `?milestone=m1&panel=${value}`)
    const c = await card('Schema Mapping')
    expect(within(c).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(await within(c).findByText('Map every legacy field')).toBeInTheDocument()
    if (user === users.manager) {
      await waitFor(() => expect(approvalRequests).toBeGreaterThan(0))   // control: a manager's requests do go out
    } else {
      await new Promise((resolve) => setTimeout(resolve, 50))   // time for a request to arrive, were one sent
      expect(approvalRequests).toBe(0)
    }
  })

  test('after switching panel tabs, Back still closes the panel, and once more leaves the tab', async () => {
    server.use(...handlers([discovery, mapping]))
    renderWithBack(users.manager)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Schema Mapping' }))
    const c = await card('Schema Mapping')
    await user.click(within(c).getByRole('tab', { name: 'Notes' }))
    await user.click(within(c).getByRole('tab', { name: 'History' }))
    expect(location()).toHaveTextContent('/m?milestone=m1&panel=history')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(location()).toHaveTextContent(/^\/m$/)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(location()).toHaveTextContent(/^\/before$/)
  })

  test('after switching panel tabs, Close then Back leaves the tab', async () => {
    server.use(...handlers([discovery, mapping]))
    renderWithBack(users.manager)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Schema Mapping' }))
    const c = await card('Schema Mapping')
    await user.click(within(c).getByRole('tab', { name: 'Work log' }))
    await user.click(within(c).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument())
    expect(location()).toHaveTextContent(/^\/m$/)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(location()).toHaveTextContent(/^\/before$/)
  })

  test('the employee variant has no Edit and no ⋯ in the panel header', async () => {
    server.use(...handlers([discovery, mapping]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    expect(within(c).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: /more actions|⋯/i })).not.toBeInTheDocument()
    expect(within(c).getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

describe('Details tab', () => {
  test('objective, criteria, skills, chips, the dependency with its state, and who is supporting', async () => {
    server.use(...handlers([discovery, mapping]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    expect(await within(c).findByText('Map every legacy field')).toBeInTheDocument()
    const criteria = within(c).getByRole('list', { name: /completion criteria/i })
    expect(within(criteria).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Customer tables mapped', 'Addresses split'])
    expect(within(within(c).getByRole('list', { name: /skills needed/i })).getByText('QA')).toBeInTheDocument()
    expect(within(c).getByLabelText('Priority: High')).toBeInTheDocument()
    expect(within(c).getByLabelText('Difficulty: Hard')).toBeInTheDocument()
    const deps = within(c).getByRole('list', { name: 'Dependencies' })
    expect(deps).toHaveTextContent('Discovery')
    expect(deps).toHaveTextContent('Completed')
    // The assignees sit in the facts above the tabs, with who only supports marked.
    expect(within(c).getByRole('group', { name: 'People on Schema Mapping' })).toBeInTheDocument()
    expect(within(c).getByLabelText('Ada Lovelace is supporting')).toBeInTheDocument()
    expect(within(c).queryByLabelText('Eli Employee is supporting')).not.toBeInTheDocument()
  })

  test('the open kickback and its review actions go to the reviewer only', async () => {
    const blocked = ms({ id: 'm1', name: 'Schema Mapping', status: 'blocked', display_status: 'blocked',
      open_kickback: kickback, can_kick_back: false, can_resolve_kickback: true, is_assignee: false })
    server.use(...handlers([blocked]))
    const first = renderTab(users.manager, '?milestone=m1')
    let c = await card('Schema Mapping')
    expect(within(within(c).getByRole('alert', { name: /kickback on schema mapping/i }))
      .getByRole('button', { name: /return to employee/i })).toBeInTheDocument()
    first.unmount()
    server.use(...handlers([{ ...blocked, can_resolve_kickback: false }]))
    renderTab(users.employee, '?milestone=m1')
    c = await card('Schema Mapping')
    const alert = within(c).getByRole('alert', { name: /kickback on schema mapping/i })
    expect(alert).toHaveTextContent('The address format is not specified anywhere.')
    expect(within(alert).queryByRole('button', { name: /return to employee/i })).not.toBeInTheDocument()
  })

  test('an assignee starts the milestone, then marks it ready for review', async () => {
    const sent = []
    server.use(...handlers([ms({ id: 'm1', name: 'Schema Mapping', status: 'not_started', display_status: 'not_started' })], [
      http.post(`${API}/milestones/m1/status`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({})
      }),
    ]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    await userEvent.click(await within(c).findByRole('button', { name: 'Start' }))
    await waitFor(() => expect(sent).toEqual([{ status: 'in_progress' }]))
  })

  test('Ready for review posts the move', async () => {
    const sent = []
    server.use(...handlers([mapping, discovery], [
      http.post(`${API}/milestones/m1/status`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({})
      }),
    ]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    await userEvent.click(await within(c).findByRole('button', { name: /ready for review/i }))
    await waitFor(() => expect(sent).toEqual([{ status: 'ready_for_review' }]))
  })

  test('a blocked not-started milestone says what it is waiting on', async () => {
    const waiting = ms({ id: 'm1', name: 'Schema Mapping', status: 'not_started', display_status: 'waiting', blocked: true,
      predecessors: ['m0'] })
    server.use(...handlers([discovery, waiting]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    const start = await within(c).findByRole('button', { name: 'Start' })
    expect(start).toBeDisabled()
    await userEvent.hover(start.parentElement)
    expect(await screen.findByText('Waiting on: Discovery')).toBeInTheDocument()
  })

  test('Claim appears in a pull project and posts the claim', async () => {
    let claimed = 0
    server.use(...handlers([ms({ id: 'm1', name: 'Schema Mapping', status: 'not_started', display_status: 'not_started',
      assignees: [], is_assignee: false, can_claim: true })], [
      http.post(`${API}/milestones/m1/claim`, () => { claimed += 1; return HttpResponse.json({}) }),
    ]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    await userEvent.click(await within(c).findByRole('button', { name: 'Claim Schema Mapping' }))
    await waitFor(() => expect(claimed).toBe(1))
  })

  test('Kick back opens the dialog', async () => {
    server.use(...handlers([mapping, discovery]))
    renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    await userEvent.click(await within(c).findByRole('button', { name: /kick back/i }))
    expect(await screen.findByRole('dialog', { name: /kick back schema mapping/i })).toBeInTheDocument()
  })

  test('"Start timer on …" only when the milestone is loggable', async () => {
    const week = (rows) => http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: null, user: null, rows,
      entries: [], totals: {}, days: [] }))
    server.use(...handlers([mapping, discovery], [week([])]))
    const first = renderTab(users.employee, '?milestone=m1')
    const c = await card('Schema Mapping')
    expect(await within(c).findByText('Map every legacy field')).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: /start timer on/i })).not.toBeInTheDocument()
    first.unmount()
    server.use(...handlers([mapping, discovery], [week([{ milestone: { id: 'm1', name: 'Schema Mapping' }, open: true }])]))
    renderTab(users.employee, '?milestone=m1')
    const again = await card('Schema Mapping')
    expect(await within(again).findByRole('button', { name: 'Start timer on Schema Mapping' })).toBeInTheDocument()
  })
})

function Named({ children }) {
  useBreadcrumb('Apollo')
  return children
}
function Crumb() {
  return <output data-testid="crumb">{useCrumbLabel()}</output>
}

describe('Discussion tab', () => {
  const thread = {
    conversation: { id: 'c1', subject: null, is_group: true, milestone: { id: 'm1', name: 'Schema Mapping', project: { id: 'p1', name: 'Apollo' } },
      participants: [{ id: users.manager.id, name: 'Morgan Manager' }, me], last_read_at: null },
    items: [{ id: 'msg1', body: 'Where are the address fields?', created_at: new Date().toISOString(), sender: { id: users.manager.id, name: 'Morgan Manager' } }],
    has_more: false,
  }
  const convo = {
    id: 'c1', subject: null, is_group: true, milestone: { id: 'm1', name: 'Schema Mapping', project: { id: 'p1', name: 'Apollo' } },
    participants: [{ id: users.manager.id, name: 'Morgan Manager' }, me], last_read_at: null,
  }

  test('a 200 renders the thread and leaves the crumb as the project name', async () => {
    server.use(...handlers([mapping, discovery], [
      http.get(`${API}/milestones/m1/discussion`, () => HttpResponse.json(convo)),
      http.get(`${API}/conversations/c1/messages`, () => HttpResponse.json(thread)),
      http.post(`${API}/conversations/c1/read`, () => HttpResponse.json({})),
    ]))
    const view = projectView(users.employee, project)
    renderAsUser(
      <BreadcrumbProvider><Named><MilestonesTab project={project} manage={view.manage} user={users.employee} view={view} /></Named><Crumb /></BreadcrumbProvider>,
      { user: users.employee, route: '/m?milestone=m1&panel=discussion' })
    const c = await card('Schema Mapping')
    const log = await within(c).findByRole('log', { name: 'Messages' })
    expect(within(log).getByText('Where are the address fields?')).toBeInTheDocument()
    expect(screen.getByTestId('crumb')).toHaveTextContent('Apollo')
  })

  test('a 404 offers a manager "Start a discussion", which posts and then shows the thread', async () => {
    let started = false
    server.use(...handlers([mapping, discovery], [
      http.get(`${API}/milestones/m1/discussion`, () => (started ? HttpResponse.json(convo)
        : HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'none' } }, { status: 404 }))),
      http.post(`${API}/milestones/m1/discussion`, () => { started = true; return HttpResponse.json(convo, { status: 201 }) }),
      http.get(`${API}/conversations/c1/messages`, () => HttpResponse.json(thread)),
      http.post(`${API}/conversations/c1/read`, () => HttpResponse.json({})),
    ]))
    renderTab(users.manager, '?milestone=m1&panel=discussion')
    const c = await card('Schema Mapping')
    await userEvent.click(await within(c).findByRole('button', { name: 'Start a discussion' }))
    expect(await within(c).findByRole('log', { name: 'Messages' })).toBeInTheDocument()
    expect(started).toBe(true)
  })

  test('"Start a discussion" is disabled with nobody assigned', async () => {
    server.use(...handlers([ms({ id: 'm1', name: 'Schema Mapping', assignees: [], is_assignee: false })]))
    renderTab(users.manager, '?milestone=m1&panel=discussion')
    const c = await card('Schema Mapping')
    const start = await within(c).findByRole('button', { name: 'Start a discussion' })
    expect(start).toBeDisabled()
    await userEvent.hover(start.parentElement)
    expect(await screen.findByText('Assign someone first')).toBeInTheDocument()
  })

  test('an employee with no discussion is told to ask their manager', async () => {
    server.use(...handlers([mapping, discovery]))
    renderTab(users.employee, '?milestone=m1&panel=discussion')
    const c = await card('Schema Mapping')
    expect(await within(c).findByText('No discussion yet. Your manager can start one.')).toBeInTheDocument()
    expect(within(c).queryByRole('button', { name: 'Start a discussion' })).not.toBeInTheDocument()
  })
})

describe('the other tabs', () => {
  test('Work log: "Post an update" with a percent posts it; someone who may not post only reads', async () => {
    const posted = []
    let updates = []
    server.use(...handlers([mapping, discovery], [
      http.get(`${API}/milestones/m1/updates`, () => HttpResponse.json(updates)),
      http.post(`${API}/milestones/m1/updates`, async ({ request }) => {
        const body = await request.json()
        posted.push(body)
        updates = [{ id: 'u1', body: body.body, percent_complete: body.percent_complete, created_at: new Date().toISOString(),
          author: { ...me, avatar_url: null } }]
        return HttpResponse.json(updates[0], { status: 201 })
      }),
    ]))
    const first = renderTab(users.employee, '?milestone=m1&panel=worklog')
    const c = await card('Schema Mapping')
    await userEvent.type(await within(c).findByRole('textbox', { name: /percent complete/i }), '55')
    await userEvent.type(within(c).getByRole('textbox', { name: /post a progress update/i }), 'Tables done')
    await userEvent.click(within(c).getByRole('button', { name: 'Post an update' }))
    await waitFor(() => expect(posted).toEqual([{ body: 'Tables done', percent_complete: 55 }]))
    expect(await within(c).findByRole('list', { name: /progress updates/i })).toHaveTextContent('Tables done')
    first.unmount()

    server.use(...handlers([ms({ id: 'm1', name: 'Schema Mapping', can_post_update: false })]))
    renderTab(users.employee, '?milestone=m1&panel=worklog')
    const again = await card('Schema Mapping')
    expect(await within(again).findByText('No updates yet.')).toBeInTheDocument()
    expect(within(again).queryByRole('button', { name: 'Post an update' })).not.toBeInTheDocument()
  })

  test('History lists kickbacks and events', async () => {
    const resolved = { ...kickback, resolution: 'returned', resolution_note: 'Split the fields.',
      resolved_at: new Date().toISOString(), resolved_by: { id: users.manager.id, name: 'Morgan Manager' } }
    server.use(...handlers([mapping, discovery], [http.get(`${API}/milestones/m1/history`, () => HttpResponse.json({
      kickbacks: [resolved],
      events: [{ id: 'e1', created_at: new Date().toISOString(), action: 'auto_assign', sentence: 'Morgan Manager auto-assigned Eli Employee' }],
    }))]))
    renderTab(users.employee, '?milestone=m1&panel=history')
    const c = await card('Schema Mapping')
    expect(await within(c).findByRole('list', { name: 'Kickbacks' })).toHaveTextContent('Split the fields.')
    expect(within(c).getByRole('list', { name: 'Events' })).toHaveTextContent(/auto-assigned Eli Employee/)
  })

  test('Notes: an assignee adds a note', async () => {
    let posted = null
    server.use(...handlers([mapping, discovery], [
      http.post(`${API}/milestones/m1/notes`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: 'n1', body: posted.body, created_at: '2026-10-13T11:00:00Z', author: me }, { status: 201 })
      }),
    ]))
    renderTab(users.employee, '?milestone=m1&panel=notes')
    const c = await card('Schema Mapping')
    await userEvent.type(await within(c).findByLabelText(/add a progress note/i), 'Mapped 40 tables')
    await userEvent.click(within(c).getByRole('button', { name: 'Add a note' }))
    await waitFor(() => expect(posted).toEqual({ body: 'Mapped 40 tables' }))
  })
})
