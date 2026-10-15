import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import RequireAuth from '../../auth/RequireAuth.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import AuditPage from './AuditPage.jsx'
import { changedFields, dayLabel, groupByDay, lookFor, predicateFor, sentenceFor, showValue } from './auditLook.js'

const entry = (overrides = {}) => ({
  id: 'a1', action: 'update', entity_type: 'project', entity_id: 'p1', request_id: 'r-1', created_at: new Date().toISOString(),
  actor: { id: 'u-admin', name: 'Avery Admin' }, changes: { before: { budget: 1000 }, after: { budget: 2000 } }, ...overrides,
})
const serve = (items, total = items.length, seen = []) => server.use(
  http.get(`${API}/audit-log`, ({ request }) => {
    seen.push(Object.fromEntries(new URL(request.url).searchParams))
    return HttpResponse.json({ total, items })
  }),
  http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
)

describe('audit look', () => {
  test('days read Today, Yesterday, then the date', () => {
    const now = new Date(2026, 9, 14, 15, 0)
    expect(dayLabel(new Date(2026, 9, 14, 9, 0).toISOString(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 13, 23, 0).toISOString(), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 12, 9, 0).toISOString(), now)).toBe('Mon, Oct 12, 2026')
  })

  test('entries group by day, newest first', () => {
    const now = new Date(2026, 9, 14, 15, 0)
    const at = (d, h) => ({ id: `${d}-${h}`, created_at: new Date(2026, 9, d, h).toISOString() })
    const groups = groupByDay([at(14, 10), at(14, 9), at(13, 8), at(10, 8)], now)
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Sat, Oct 10, 2026', 1]])
  })

  test('changed fields read as labels, with statuses humanised and unchanged fields left out', () => {
    expect(changedFields({ before: { status: 'in_progress', budget: 5 }, after: { status: 'completed', budget: 5 } }))
      .toEqual([{ field: 'Status', from: 'In progress', to: 'Completed' }])
    expect(changedFields({ before: null, after: { name: 'Apollo', end_date: null } }))
      .toEqual([{ field: 'Name', from: null, to: 'Apollo' }])
    expect(changedFields(null)).toEqual([])
    // An executive's copy has the salary removed on both sides: nothing to show, nothing breaks.
    expect(changedFields({ before: {}, after: { job_title: 'Lead' } })).toEqual([{ field: 'Job title', from: '—', to: 'Lead' }])
  })

  test('values', () => {
    expect(showValue(true)).toBe('Yes')
    expect(showValue(['a', 'b'])).toBe('a, b')
    expect(showValue([])).toBe('—')
    expect(showValue('on_hold', 'status')).toBe('On hold')
    expect(showValue('on_hold', 'name')).toBe('on_hold')
    expect(showValue('pending', 'status')).toBe('Pending approval')
  })

  test('each kind of action has its own icon and colour; completing a milestone looks like completion', () => {
    expect(lookFor({ action: 'approve' }).color).toBe('success')
    expect(lookFor({ action: 'reject' }).color).toBe('error')
    expect(lookFor({ action: 'archive' }).color).toBe('warning')
    expect(lookFor({ action: 'status_change', changes: { after: { status: 'completed' } } })).toBe(lookFor({ action: 'complete' }))
    expect(lookFor({ action: 'something_new' }).Icon).toBeTruthy()
  })

  test('sentence from the server summary, or built from the action', () => {
    const summary = { actor: { name: 'Morgan Manager' }, sentence: 'Morgan Manager approved 9h for Eli Employee on Schema Mapping' }
    expect(sentenceFor(entry({ summary }))).toBe(summary.sentence)
    expect(predicateFor(entry({ summary }))).toBe('approved 9h for Eli Employee on Schema Mapping')
    expect(sentenceFor(entry({ action: 'add_member', actor: { id: null, name: 'System' } }))).toBe('System add member project')
  })
})

describe('AuditPage', () => {
  test('not reachable by a manager', () => {
    renderAsUser(<RequireAuth roles={['admin']}><AuditPage /></RequireAuth>, { user: users.manager, route: '/audit', path: '/audit' })
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
  })

  test('a timeline grouped by day with readable sentences, avatars and field changes', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString()
    serve([
      entry({ id: 'a1', action: 'approve', entity_type: 'time_entry', actor: { id: 'u-mgr', name: 'Morgan Manager' },
        changes: { before: { status: 'pending' }, after: { status: 'approved', reason: null } },
        summary: { actor: { id: 'u-mgr', name: 'Morgan Manager' }, project: { id: 'p1', name: 'Apollo' },
          sentence: 'Morgan Manager approved 9h for Eli Employee on Schema Mapping' } }),
      entry({ id: 'a2', action: 'status_change', entity_type: 'milestone', created_at: yesterday, actor: { id: null, name: 'System' },
        changes: { before: { status: 'in_progress' }, after: { status: 'completed' } } }),
    ])
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByText('approved 9h for Eli Employee on Schema Mapping')).toBeInTheDocument()
    expect(within(today).getByRole('link', { name: 'Morgan Manager' })).toHaveAttribute('href', '/people/u-mgr/profile')
    expect(within(today).getByRole('link', { name: 'Apollo' })).toHaveAttribute('href', '/projects/p1')
    expect(within(today).getByRole('listitem', { name: 'Status: Pending approval → Approved' })).toBeInTheDocument()
    const older = screen.getByRole('region', { name: 'Yesterday' })
    expect(within(older).getByText('System')).toBeInTheDocument()
    expect(within(older).getByTestId('SettingsOutlinedIcon')).toBeInTheDocument()
    expect(within(older).getByRole('listitem', { name: 'Status: In progress → Completed' })).toBeInTheDocument()
  })

  test('raw JSON and the request id stay behind a toggle', async () => {
    serve([entry({ changes: { before: { budget: 1000, status: 'active', end_date: null }, after: { budget: 2000, status: 'active', end_date: '2026-12-31' } } })])
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    const user = userEvent.setup()
    const list = await screen.findByRole('list', { name: /changed fields/i })
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label')))
      .toEqual(['Budget: 1000 → 2000', 'End date: — → 2026-12-31'])
    expect(screen.queryByText(/"budget": 2000/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show raw json/i }))
    expect(await screen.findByText(/"budget": 2000/)).toBeInTheDocument()
    expect(screen.getByText(/request id: r-1/i)).toBeInTheDocument()
  })

  test('an executive copy without salary values still renders', async () => {
    serve([entry({ entity_type: 'user', changes: { before: { job_title: 'Dev' }, after: { job_title: 'Lead' } } })])
    renderAsUser(<AuditPage />, { user: users.executive, route: '/audit', path: '/audit' })
    expect(await screen.findByRole('listitem', { name: 'Job title: Dev → Lead' })).toBeInTheDocument()
    expect(screen.queryByText(/salary/i)).not.toBeInTheDocument()
  })

  test('Who and Action filters are sent to the server', async () => {
    const seen = []
    server.use(
      http.get(`${API}/audit-log`, ({ request }) => {
        seen.push(Object.fromEntries(new URL(request.url).searchParams))
        return HttpResponse.json({ total: 0, items: [] })
      }),
      http.get(`${API}/users`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('archived') === 'true'
        ? { items: [{ id: 'u-old', first_name: 'Olive', last_name: 'Old', username: 'oold', role: 'employee', is_archived: true }], total: 1 }
        : { items: [{ id: 'u-blake', first_name: 'Blake', last_name: 'Admin', username: 'badmin', role: 'admin' }], total: 1 })),
    )
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('combobox', { name: /who/i }), 'bla')
    await user.click(await screen.findByRole('option', { name: /blake admin/i }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ actor: 'u-blake' }))
    await user.click(screen.getByRole('combobox', { name: /action/i }))
    await user.click(await screen.findByRole('option', { name: /^archive$/i }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ actor: 'u-blake', action: 'archive' }))
    await user.clear(screen.getByRole('combobox', { name: /who/i }))
    await user.type(screen.getByRole('combobox', { name: /who/i }), 'oli')
    expect(await screen.findByRole('option', { name: /olive old \(archived\)/i })).toBeInTheDocument()
  })

  test('pages through long logs, back to page 1 when a filter changes', async () => {
    const seen = []
    serve(Array.from({ length: 3 }, (_, i) => entry({ id: `a${i}` })), 120, seen)
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    const user = userEvent.setup()
    await screen.findByText('120 entries · page 1 of 3')
    expect(seen.at(-1)).toMatchObject({ page: '1', page_size: '50' })
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ page: '2' }))
    await user.click(screen.getByRole('combobox', { name: /record type/i }))
    await user.click(await screen.findByRole('option', { name: /^milestone$/i }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ page: '1', entity_type: 'milestone' }))
  })

  test('the CSV export still offers the entries, now with the sentence', async () => {
    serve([entry({ summary: { actor: { name: 'Avery Admin' }, sentence: 'Avery Admin updated Apollo' } })])
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    await screen.findByText('updated Apollo')
    expect(screen.getByRole('button', { name: /export csv/i })).toBeEnabled()
  })
})
