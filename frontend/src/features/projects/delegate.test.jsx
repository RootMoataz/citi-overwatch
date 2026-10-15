import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import NotificationBell from '../../components/NotificationBell.jsx'
import ApprovalRow from '../approvals/ApprovalRow.jsx'
import ProjectDetailPage from './ProjectDetailPage.jsx'

const project = (overrides = {}) => ({
  id: 'p1', name: 'Apollo Data Migration', description: 'Move records', status: 'active',
  start_date: '2026-01-01', predicted_end_date: '2026-12-31', budget: 250000, consumed: 50000,
  budget_pct: 20, progress_pct: 33.3, at_risk_reasons: [], is_archived: false, completed_at: null,
  manager: { id: users.manager.id, name: 'Morgan Manager' }, department: null, work_mode: 'push', delegate: null, ...overrides,
})

const people = [
  { id: users.manager.id, username: 'manager.demo', first_name: 'Morgan', last_name: 'Manager', job_title: '' },
  { id: 'u-dee', username: 'dee', first_name: 'Dee', last_name: 'Legate', job_title: '' },
]

function handlers(p, puts) {
  return [
    http.get(`${API}/projects/p1`, () => HttpResponse.json(p)),
    http.get(`${API}/projects/p1/summary`, () => HttpResponse.json({ project: p, budget: p.budget, consumed: p.consumed,
      remaining: p.budget - p.consumed, budget_pct: 20, progress_pct: 33.3, at_risk_reasons: [], member_count: 1 })),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/users`, () => HttpResponse.json({ items: people, total: people.length })),
    http.put(`${API}/projects/p1`, async ({ request }) => { puts.push(await request.json()); return HttpResponse.json(p) }),
  ]
}

describe('delegate approver on a project', () => {
  let puts
  beforeEach(() => { puts = [] })

  test('the overview says who the approvals are delegated to and until when', async () => {
    server.use(...handlers(project({ delegate: { id: 'u-dee', name: 'Dee Legate', until: '2026-10-20', active: true } }), puts))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByText(/approvals delegated to/i)).toHaveTextContent('Approvals delegated to Dee Legate until Oct 20, 2026')
  })

  test('without an end date it runs until removed; an ended delegation says so', async () => {
    server.use(...handlers(project({ delegate: { id: 'u-dee', name: 'Dee Legate', until: null, active: true } }), puts))
    const { unmount } = renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByText(/approvals delegated to/i)).toHaveTextContent('Approvals delegated to Dee Legate until further notice')
    unmount()
    server.use(...handlers(project({ delegate: { id: 'u-dee', name: 'Dee Legate', until: '2026-10-01', active: false } }), puts))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByText(/delegation to dee legate ended/i)).toHaveTextContent('Oct 1, 2026')
  })

  test('the manager picks a delegate and an end date in the project dialog', async () => {
    server.use(...handlers(project(), puts))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1', path: '/projects/:id' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /edit/i }))
    const dialog = await screen.findByRole('dialog', { name: /edit project/i })
    await user.click(within(dialog).getByRole('combobox', { name: /delegate approver/i }))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['No delegate', 'Dee Legate'])  // never the project's own manager
    await user.click(screen.getByRole('option', { name: 'Dee Legate' }))
    await user.type(within(dialog).getByLabelText(/delegate until/i), '2026-12-01')
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toMatchObject({ delegate_approver_id: 'u-dee', delegate_until: '2026-12-01' })
  })

  test('removing the delegate sends null, and an unchanged delegate is not sent at all', async () => {
    server.use(...handlers(project({ delegate: { id: 'u-dee', name: 'Dee Legate', until: '2026-10-01', active: false } }), puts))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/p1', path: '/projects/:id' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /edit/i }))
    let dialog = await screen.findByRole('dialog', { name: /edit project/i })
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).not.toHaveProperty('delegate_approver_id')
    expect(puts[0]).not.toHaveProperty('delegate_until')

    await user.click(await screen.findByRole('button', { name: /edit/i }))
    dialog = await screen.findByRole('dialog', { name: /edit project/i })
    await user.click(within(dialog).getByRole('combobox', { name: /delegate approver/i }))
    await user.click(await screen.findByRole('option', { name: 'No delegate' }))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[1]).toMatchObject({ delegate_approver_id: null })
  })
})

describe('delegated items in the approvals queue', () => {
  const item = (delegatedFrom) => ({
    entry: { id: 'e1', work_date: '2026-10-12', hours: 6, over_40: false, edited_after_decision: false },
    user: { id: 'u-ada', name: 'Ada Lovelace' }, project: { id: 'p1', name: 'Apollo' }, milestone: { id: 'm1', name: 'Build' },
    label: 'Pending approval', week_logged_total: 20, delegated_from: delegatedFrom,
  })

  test('say whose queue they come from', () => {
    renderAsUser(<ApprovalRow item={item({ id: 'u-mona', name: 'Mona Lisa' })} />, { user: users.manager })
    expect(screen.getByText('Delegated from Mona Lisa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
  })

  test("the manager's own items carry no label", () => {
    renderAsUser(<ApprovalRow item={item(null)} />, { user: users.manager })
    expect(screen.queryByText(/delegated from/i)).not.toBeInTheDocument()
  })
})

test("the delegate's alert opens the project's hours in Approvals", async () => {
  server.use(
    http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n9', type: 'DELEGATE_ASSIGNED', week_start: null,
      read_at: null, subject_user: { id: users.manager.id, name: 'Morgan Manager' },
      payload: { project: { id: 'p1', name: 'Apollo' }, manager: { id: users.manager.id, name: 'Morgan Manager' }, until: null },
      message: 'Morgan Manager made you the delegate approver for Apollo: you can approve hours for Morgan Manager until further notice' }])),
    http.post(`${API}/notifications/n9/read`, () => HttpResponse.json({ id: 'n9', read: true })),
  )
  renderAsUser(<NotificationBell />, { user: users.admin, route: '/', path: '/' })
  await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: /delegate approver for apollo/i }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/approvals?project=p1'))
})
