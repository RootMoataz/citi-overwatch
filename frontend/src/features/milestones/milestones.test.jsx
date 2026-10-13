import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import MilestonesTab from './MilestonesTab.jsx'

const project = {
  id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31', status: 'active',
  manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [],
}
const me = { id: users.employee.id, name: 'Eli Employee' }

const ms = (overrides) => ({
  project_id: 'p1', description: '', status: 'not_started', display_status: 'not_started', blocked: false,
  predecessors: [], assignees: [], is_assignee: false, completed_at: null, is_archived: false, ...overrides,
})

const discovery = ms({ id: 'm1', name: 'Discovery', start_date: '2026-01-05', end_date: '2026-02-28', status: 'in_progress',
  display_status: 'in_progress', assignees: [me], is_assignee: true })
const mapping = ms({ id: 'm2', name: 'Schema Mapping', start_date: '2026-03-01', end_date: '2026-06-30',
  display_status: 'blocked', blocked: true, predecessors: ['m1'], assignees: [me], is_assignee: true })
const cutover = ms({ id: 'm3', name: 'Cutover', start_date: '2026-07-01', end_date: '2026-09-30' })

function handlers(list = [discovery, mapping, cutover], extra = []) {
  return [
    ...extra,
    http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json(list)),
    http.get(`${API}/projects/p1/members`, () => HttpResponse.json([
      { user: { id: me.id, first_name: 'Eli', last_name: 'Employee', job_title: 'Engineer', username: 'eli' }, planned_hours_per_week: 30 }])),
    http.get(`${API}/milestones/:id/notes`, () => HttpResponse.json([])),
    http.get(`${API}/approvals`, () => HttpResponse.json([])),
  ]
}

function renderTab(user, manage) {
  return renderAsUser(<MilestonesTab project={project} manage={manage} user={user} />, { user, route: '/milestones-under-test' })
}

const card = async (name) => (await screen.findByRole('heading', { name, level: 3 })).closest('[data-milestone]')

describe('MilestonesTab', () => {
  test('employee sees all milestones but actions only on assigned ones', async () => {
    server.use(...handlers())
    renderTab(users.employee, false)
    const disc = await card('Discovery')
    expect(within(disc).getByRole('button', { name: /ready for review/i })).toBeEnabled()
    const cut = await card('Cutover')
    expect(within(cut).queryByRole('button', { name: /start|ready|complete/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add milestone/i })).not.toBeInTheDocument()
    expect(within(disc).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  test('blocked milestone start button disabled with tooltip naming predecessors', async () => {
    server.use(...handlers())
    renderTab(users.employee, false)
    const map = await card('Schema Mapping')
    const start = within(map).getByRole('button', { name: /start/i })
    expect(start).toBeDisabled()
    expect(within(map).getByText('Blocked')).toBeInTheDocument()
    await userEvent.hover(start.parentElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Waiting on: Discovery')
  })

  test('assignee marks ready for review; manager completes', async () => {
    const calls = []
    server.use(...handlers([discovery, mapping, cutover], [
      http.post(`${API}/milestones/:id/status`, async ({ params, request }) => {
        calls.push([params.id, (await request.json()).status])
        return HttpResponse.json({ ...discovery, status: 'ready_for_review', display_status: 'ready_for_review' })
      })]))
    const first = renderTab(users.employee, false)
    await userEvent.click(within(await card('Discovery')).getByRole('button', { name: /ready for review/i }))
    await waitFor(() => expect(calls).toEqual([['m1', 'ready_for_review']]))
    first.unmount()

    const review = { ...discovery, status: 'ready_for_review', display_status: 'ready_for_review', is_assignee: false }
    server.use(...handlers([review, mapping, cutover], [
      http.post(`${API}/milestones/:id/status`, async ({ params, request }) => {
        calls.push([params.id, (await request.json()).status])
        return HttpResponse.json({ ...review, status: 'completed', display_status: 'completed' })
      })]))
    renderTab(users.manager, true)
    const disc = await card('Discovery')
    expect(within(disc).getByRole('button', { name: /send back/i })).toBeInTheDocument()
    await userEvent.click(within(disc).getByRole('button', { name: /^complete$/i }))
    await waitFor(() => expect(calls.at(-1)).toEqual(['m1', 'completed']))
  })

  test('cycle error shown in dialog', async () => {
    server.use(...handlers([discovery, mapping, cutover], [
      http.put(`${API}/milestones/m1`, async ({ request }) => HttpResponse.json({ ...discovery, ...(await request.json()) })),
      http.put(`${API}/milestones/m1/dependencies`, () => HttpResponse.json(
        { error: { code: 'DEPENDENCY_CYCLE', message: 'That dependency would create a loop' } }, { status: 400 })),
    ]))
    renderTab(users.manager, true)
    const user = userEvent.setup()
    await user.click(within(await card('Discovery')).getByRole('button', { name: /edit discovery/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit milestone/i })
    await user.click(within(dialog).getByRole('combobox', { name: /depends on/i }))
    await user.click(await screen.findByRole('option', { name: /^Schema Mapping/ }))
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    expect(await within(dialog).findByText('That dependency would create a loop.')).toBeInTheDocument()
  })

  test('date range outside the project is explained', async () => {
    server.use(...handlers([], [
      http.post(`${API}/projects/p1/milestones`, () => HttpResponse.json(
        { error: { code: 'OUT_OF_PROJECT_RANGE', message: 'Milestone dates must fall between 2026-01-01 and 2026-12-31' } },
        { status: 400 }))]))
    renderTab(users.manager, true)
    const user = userEvent.setup()
    expect(await screen.findByText(/no milestones yet/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add milestone/i }))
    const dialog = await screen.findByRole('dialog', { name: /new milestone/i })
    await user.type(within(dialog).getByLabelText(/^name/i), 'Late')
    await user.type(within(dialog).getByLabelText(/start date/i), '2027-01-01')
    await user.type(within(dialog).getByLabelText(/end date/i), '2027-02-01')
    await user.click(within(dialog).getByRole('button', { name: /save/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('must fall between')
  })

  test('timeline renders a bar per milestone with accessible labels', async () => {
    server.use(...handlers())
    renderTab(users.employee, false)
    const timeline = await screen.findByRole('list', { name: /milestone timeline/i })
    const bars = within(timeline).getAllByRole('listitem')
    expect(bars).toHaveLength(3)
    expect(bars[1]).toHaveAccessibleName(/Schema Mapping, Mar 1, 2026 to Jun 30, 2026, Blocked/)
    expect(bars[1]).toHaveAttribute('tabindex', '0')
  })

  test('notes thread shows authors and lets assignees post', async () => {
    let posted = null
    server.use(...handlers([discovery], [
      http.get(`${API}/milestones/m1/notes`, () => HttpResponse.json([
        { id: 'n1', body: 'Inventory done', created_at: '2026-10-13T10:00:00Z', author: { id: 'u-mgr', name: 'Morgan Manager' } }])),
      http.post(`${API}/milestones/m1/notes`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: 'n2', body: posted.body, created_at: '2026-10-13T11:00:00Z', author: me }, { status: 201 })
      })]))
    renderTab(users.employee, false)
    const user = userEvent.setup()
    await user.click(within(await card('Discovery')).getByRole('button', { name: /notes/i }))
    expect(await screen.findByText('Inventory done')).toBeInTheDocument()
    expect(screen.getByText('Morgan Manager')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/add a progress note/i), 'Mapped 40 tables')
    await user.click(screen.getByRole('button', { name: /post note/i }))
    await waitFor(() => expect(posted).toEqual({ body: 'Mapped 40 tables' }))
  })
})
