import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useWaitingCount } from '../../api/queries.js'
import { AppProviders } from '../../app/providers.jsx'
import { makeQueryClient } from '../../app/queryClient.js'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setPrefersDark, setViewport } from '../../test/setup.js'
import TimesheetsPage from './TimesheetsPage.jsx'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const ben = { id: 'u-ben', name: 'Ben Okafor' }
const ana = { id: 'u-ana', name: 'Ana Ruiz' }
const UPDATED = '2026-10-14T18:00:00.123456+00:00'
const manual = (id, person, day, hours, reason, details, extra = {}) => ({
  entry: { id, user_id: person.id, milestone_id: 'm1', project_id: 'p1', work_date: day, hours, status: 'pending',
    over_40: false, edited_after_decision: false, updated_at: UPDATED, note: 'Worked on the mapping tables',
    manual: { reason, details }, ...extra },
  label: 'Pending approval', user: person, milestone: { id: 'm1', name: 'Schema Mapping' },
  project: { id: 'p1', name: 'Apollo Data Migration' }, week_logged_total: hours, progress_update: null, flags: [],
  delegated_from: null,
})
const bens = () => manual('e1', ben, '2026-10-14', 2.5, 'forgot_timer', null, { over_40: true })
const anas = () => manual('e2', ana, '2026-10-15', 1, 'other', 'Whiteboard session with the client')
const withKim = () => ({ ...bens(), delegated_from: { id: 'u-kim', name: 'Kim Lee' } })

let listed
let asked
let posts
function api({ list = [withKim(), anas()], approve, request } = {}) {
  listed = list
  asked = []
  posts = []
  server.use(
    http.get(`${API}/manual-hours`, ({ request: r }) => {
      asked.push(new URL(r.url).search)
      return HttpResponse.json(listed)
    }),
    http.get(`${API}/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/time-entries/:id/breakdown`, () => HttpResponse.json({ hours: 2.5, request_cost: 100, hourly_rate: null,
      milestone_cost: 10, milestone_cost_after: 110, remaining_before: 900, remaining_after: 800, budget: 1000,
      pct_of_remaining: 11, forecast: null })),
    http.post(`${API}/manual-hours/:id/approve`, async ({ request: r, params }) => {
      const body = await r.json()
      posts.push({ path: 'approve', id: params.id, body })
      const answer = await approve?.(params.id)
      if (answer) return answer
      listed = listed.filter((i) => i.entry.id !== params.id)
      return HttpResponse.json({ id: params.id, status: 'approved' })
    }),
    http.post(`${API}/manual-hours/:id/request-changes`, async ({ request: r, params }) => {
      const body = await r.json()
      posts.push({ path: 'request-changes', id: params.id, body })
      const answer = await request?.(params.id)
      if (answer) return answer
      listed = listed.filter((i) => i.entry.id !== params.id)
      return HttpResponse.json({ id: params.id, status: 'rejected' })
    }),
  )
}
const open = (route = '/timesheets?tab=manual', user = users.manager) =>
  renderAsUser(<TimesheetsPage />, { user, route, path: '/timesheets' })

describe('the Manual hours tab', () => {
  test('it sits after To review with its count and ?tab=manual selects it', async () => {
    api()
    open()
    const tab = await screen.findByRole('tab', { name: 'Manual hours 2' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab').map((t) => t.textContent).slice(0, 2)).toEqual(['To review', 'Manual hours 2'])
  })

  test('it lists the requests in the server order with the intro, columns, reason and flags', async () => {
    api()
    open()
    expect(await screen.findByText('Hours logged without the timer. Each needs its own decision; Approve week never includes them.'))
      .toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Manual hours' })
    for (const h of ['Person', 'Date', 'Milestone', 'Hours', 'Why not the timer', 'Work note', 'Flags']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument()
    }
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Ben Okafor')
    expect(rows[1]).toHaveTextContent('Ana Ruiz')
    expect(rows[0]).toHaveTextContent('Wed 14 Oct')
    expect(rows[0]).toHaveTextContent('Apollo Data Migration')
    expect(within(rows[0]).getByText('Forgot to start the timer')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Overtime')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Delegated from Kim Lee')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Other')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Whiteboard session with the client')).toBeInTheDocument()
  })

  test('Approve posts the hours and version it saw, and toasts', async () => {
    api()
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Approve 2.5h, Ben Okafor, Wed 14 Oct' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ path: 'approve', id: 'e1', body: { expected_hours: 2.5, expected_updated_at: UPDATED } })
    expect(await screen.findByText('Approved 2.5h for Ben Okafor')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Forgot to start the timer')).not.toBeInTheDocument())
  })

  test('Request changes needs a reason, then sends it with the same guard', async () => {
    api()
    open()
    const user = userEvent.setup()
    await user.click((await screen.findAllByRole('button', { name: /^Request changes/ }))[0])
    const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
    expect(within(dialog).getByText('Ben sees your reason on their timesheet and can fix and resubmit.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    expect(await within(dialog).findByText('Tell the employee why')).toBeInTheDocument()
    expect(posts).toHaveLength(0)
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Wrong day')
    await user.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ path: 'request-changes', id: 'e1',
      body: { reason: 'Wrong day', expected_hours: 2.5, expected_updated_at: UPDATED } })
    expect(await screen.findByText('Sent back to Ben Okafor')).toBeInTheDocument()
  })

  test('a stale answer to Request changes keeps the dialog open with the typed reason', async () => {
    api({ request: () => HttpResponse.json({ error: { code: 'STALE_ENTRY', message: 'These hours changed since you loaded them.' } },
      { status: 409 }) })
    open()
    const user = userEvent.setup()
    await user.click((await screen.findAllByRole('button', { name: /^Request changes/ }))[0])
    const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Wrong day')
    await user.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(await screen.findAllByText('These hours changed since you loaded them.')).not.toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'Request changes' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Reason/ })).toHaveValue('Wrong day')
    await waitFor(() => expect(asked.length).toBeGreaterThan(1))
  })

  test('Budget impact opens the breakdown under the row', async () => {
    api()
    open()
    const user = userEvent.setup()
    const button = (await screen.findAllByRole('button', { name: /^Budget impact/ }))[0]
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('This request')).toBeInTheDocument()
  })

  test('a stale answer shows inside the row and the list is requested again', async () => {
    api({ approve: () => HttpResponse.json({ error: { code: 'STALE_ENTRY', message: 'These hours changed since you loaded them.' } },
      { status: 409 }) })
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Approve 2.5h, Ben Okafor, Wed 14 Oct' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('These hours changed since you loaded them.')
    const body = alert.closest('tbody')
    expect(body).toHaveTextContent('Ben Okafor')
    expect(within(body).getByRole('button', { name: /^Approve 2.5h/ })).toBeInTheDocument()
    await waitFor(() => expect(asked.length).toBeGreaterThan(1))
  })

  test('an error for a request the refetch dropped moves to the top, titled with the person and day', async () => {
    api({ approve: () => {
      listed = listed.filter((i) => i.entry.id !== 'e1')
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'That request is gone.' } }, { status: 404 })
    } })
    open()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Approve 2.5h, Ben Okafor, Wed 14 Oct' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Ben Okafor · Wed 14 Oct'))
    expect(screen.getByRole('alert')).toHaveTextContent('That request is gone.')
    await waitFor(() => expect(screen.queryByRole('row', { name: /Ben Okafor/ })).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /Ana Ruiz/ })).toBeInTheDocument()
  })

  test('?user= filters the request and Show everyone clears it', async () => {
    api()
    open('/timesheets?tab=manual&user=u-ben')
    const user = userEvent.setup()
    await screen.findByRole('table', { name: 'Manual hours' })
    expect(asked).toContain('?user=u-ben')
    await user.click(screen.getByRole('button', { name: 'Show everyone' }))
    await waitFor(() => expect(asked).toContain(''))
    expect(screen.queryByRole('button', { name: 'Show everyone' })).not.toBeInTheDocument()
  })

  test('with nothing waiting it says so', async () => {
    api({ list: [] })
    open()
    expect(await screen.findByText('No manual hours waiting')).toBeInTheDocument()
    expect(screen.getByText('Hours your team logs without the timer show up here.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Manual hours 0' })).toBeInTheDocument()
  })

  test('on a phone it is cards with three buttons each, no table', async () => {
    setViewport(375)
    api()
    open()
    expect(await screen.findByRole('button', { name: 'Approve 2.5h, Ben Okafor, Wed 14 Oct' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Ben Okafor')
    for (const card of cards) expect(within(card).getAllByRole('button')).toHaveLength(3)
  })

  test('in dark mode it renders without a console error', async () => {
    setPrefersDark(true)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    api()
    open()
    expect(await screen.findByRole('table', { name: 'Manual hours' })).toBeInTheDocument()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
    setPrefersDark(false)
  })

  test('To review points to the same person-week hours waiting in Manual hours', async () => {
    api({ list: [bens()] })
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([{
      entry: { id: 'a1', user_id: ben.id, milestone_id: 'm1', project_id: 'p1', work_date: '2026-10-13', hours: 4,
        status: 'pending', over_40: false, edited_after_decision: false, note: '', label: 'Pending approval' },
      label: 'Pending approval', user: ben, milestone: { id: 'm1', name: 'Schema Mapping' },
      project: { id: 'p1', name: 'Apollo Data Migration' }, week_logged_total: 4, delegated_from: null }])))
    open('/timesheets')
    const link = await screen.findByRole('link', { name: '2.5h more in Manual hours' })
    expect(link).toHaveAttribute('href', '/timesheets?tab=manual&user=u-ben')
    expect(link.closest('section')).toHaveTextContent('· 2.5h more in Manual hours')
  })
})

describe('the sidebar count', () => {
  const Probe = ({ enabled }) => <output aria-label="waiting">{useWaitingCount(enabled)}</output>
  const probe = (enabled, client = makeQueryClient({ test: true })) => ({ client, ...render(
    <AppProviders queryClient={client}>
      <MemoryRouter><Probe enabled={enabled} /></MemoryRouter>
    </AppProviders>) })

  test('adds the approvals and the manual requests, and drops once the list refetches', async () => {
    api({ list: [withKim(), anas()] })
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([{ entry: { id: 'a1' } }, { entry: { id: 'a2' } },
      { entry: { id: 'a3' } }])))
    const { client } = probe(true)
    await waitFor(() => expect(screen.getByLabelText('waiting')).toHaveTextContent('5'))
    listed = [anas()]
    await client.invalidateQueries({ queryKey: ['manual-hours'] })
    await waitFor(() => expect(screen.getByLabelText('waiting')).toHaveTextContent('4'))
  })

  test('is 0 and silent for people who cannot review', async () => {
    api()
    const requested = []
    server.events.on('request:start', ({ request }) => requested.push(new URL(request.url).pathname))
    probe(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByLabelText('waiting')).toHaveTextContent('0')
    expect(requested.filter((p) => /approvals|manual-hours/.test(p))).toEqual([])
    server.events.removeAllListeners()
  })
})
