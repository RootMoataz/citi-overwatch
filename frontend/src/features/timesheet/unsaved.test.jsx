// My timesheet keeps unsaved typing in this tab (sessionStorage, spec D9 and §5.2): a reload brings it back with a
// notice; only Submit or Save & resubmit sends hours, and both take what they sent out of storage.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const PREV = '2026-10-05'
const MON = WEEK
const TUE = '2026-10-13'
const WED = '2026-10-14'
const KEY = 'overwatch.timesheet.unsaved.u-emp.2026-10-12'
const PREV_KEY = 'overwatch.timesheet.unsaved.u-emp.2026-10-05'
const NOTE = 'Mapped customer records and validated source fields.'
const NOTICE = 'Unsaved changes restored. Submit to send them.'
const REASON = 'Please add a clearer breakdown of the work completed.'

const build = { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true }
const mapping = { milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true }
const cutover = { milestone: { id: 'm3', name: 'Cutover', status: 'in_progress' }, project: { id: 'p2', name: 'Atlas', status: 'on_hold' }, open: false }
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: MON, hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: NOTE, source: 'manual', tracked_hours: 0,
  label: 'Pending approval', ...overrides })

const body = ({ week = WEEK, rows = [build, mapping], entries = [entry()] } = {}) => ({ week_start: week,
  user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries, drafts: [], locks: [],
  totals: { logged: entries.reduce((s, e) => s + (e.status === 'rejected' ? 0 : e.hours), 0), approved: 0, draft: 0 } })
const sheet = (options) => http.get(`${API}/time-entries`, () => HttpResponse.json(body(options)))
const recordPuts = (puts) => http.put(`${API}/time-entries`, async ({ request }) => {
  puts.push(await request.json())
  return HttpResponse.json(body())
})

const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />,
  { user: users.employee, route, path: '/timesheet' })
const stored = (key = KEY) => JSON.parse(sessionStorage.getItem(key))
const store = (value, key = KEY) => sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))

/** Types hours into a cell and a note through its note button, as a person does on the Week grid. */
async function typeCell(user, label, hours, note) {
  await user.type(await screen.findByLabelText(label), hours)
  if (!note) return
  await user.click(screen.getByRole('button', { name: `Add work note, ${label}` }))
  await user.type(await screen.findByLabelText(/what did you work on/i), note)
  await user.click(screen.getByRole('button', { name: 'Done' }))
}

beforeEach(() => {
  localStorage.setItem('overwatch.timesheet.view', 'week')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => {
  server.events.removeAllListeners()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('unsaved typing is kept in this tab', () => {
  test('typing 9 on Tue with a note stores the hours and the note under the user and week', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9', NOTE)
    await waitFor(() => expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: { [`m1|${TUE}`]: NOTE } }))
    expect(Object.keys(sessionStorage)).toEqual([KEY])
    // Never in localStorage: it would outlive the tab.
    expect(Object.keys(localStorage).filter((k) => k.includes('unsaved'))).toEqual([])
  })

  test('after unmounting and rendering again, Tue reads 9, the notice shows and Submit 1 change is enabled; no PUT until Submit', async () => {
    const puts = []
    const methods = []
    server.events.on('request:start', ({ request }) => methods.push(request.method))
    server.use(sheet(), recordPuts(puts))
    const first = renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9', NOTE)
    await waitFor(() => expect(stored()).not.toBeNull())
    first.unmount()

    renderSheet()
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    expect(screen.getByTestId('week-total')).toHaveTextContent('17h counted of 40h')
    expect(screen.getByRole('button', { name: 'Edit work note, Schema Mapping, Tue Oct 13' })).toBeInTheDocument()
    expect(puts).toEqual([])
    expect(methods.filter((m) => m !== 'GET')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: TUE, hours: 9, note: NOTE }] })
  })

  test('Submit removes the key and the notice', async () => {
    const puts = []
    store({ drafts: { [`m1|${TUE}`]: '9' }, notes: { [`m1|${TUE}`]: NOTE } })
    server.use(sheet(), recordPuts(puts))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull())
    await waitFor(() => expect(screen.queryByText(NOTICE)).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })

  test('the notice closes with its Close button and the typing stays', async () => {
    store({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} })
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    const notice = (await screen.findByText(NOTICE)).closest('[role="status"]')
    await user.click(within(notice).getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} })
  })

  test('a restored value equal to the saved one is no change: no notice and nothing to submit', async () => {
    store({ drafts: { [`m1|${MON}`]: '8' }, notes: {} })
    server.use(sheet())
    renderSheet()
    expect(await screen.findByLabelText('Schema Mapping, Mon Oct 12')).toHaveValue('8')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
  })

  test('discarding on a week change removes that week\'s key', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9')
    await waitFor(() => expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} }))
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 5 – 11, 2026' })).toBeInTheDocument()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  test('Stay on the discard question keeps the typing and its key', async () => {
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9')
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard 1 unsaved change?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} })
  })

  test('Save & resubmit takes only its cell out of storage; the other typing stays stored and restorable', async () => {
    const puts = []
    const rejected = entry({ id: 'c', work_date: WED, status: 'rejected', label: 'Rejected', rejection_reason: REASON })
    server.use(sheet({ entries: [entry(), rejected] }), recordPuts(puts))
    const first = renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9')
    await user.click(await screen.findByRole('button', { name: 'Needs revision, details for Schema Mapping, Wed Oct 14' }))
    const region = await screen.findByRole('complementary', { name: 'Entry details' })
    const hours = within(region).getByLabelText('Hours')
    await user.clear(hours)
    await user.type(hours, '6')
    await waitFor(() => expect(stored().drafts).toEqual({ [`m1|${TUE}`]: '9', [`m1|${WED}`]: '6' }))
    await user.click(within(region).getByRole('button', { name: 'Save & resubmit' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WED, hours: 6 }] })
    await waitFor(() => expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} }))
    first.unmount()

    renderSheet()
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
  })

  test('another account in the same tab never sees the first one\'s typing', async () => {
    store({ drafts: { [`m1|${TUE}`]: '9' }, notes: { [`m1|${TUE}`]: NOTE } })
    server.use(sheet())
    renderAsUser(<TimesheetPage />, { user: { ...users.employee, id: 'u-other', username: 'other.demo' },
      route: `/timesheet?week=${WEEK}`, path: '/timesheet' })
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
    expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: { [`m1|${TUE}`]: NOTE } })
  })
})

describe('restoring after the week changed underneath (Review Focus 3)', () => {
  test('stored cells for m9 (not a row) and for an on-hold row are not restored, and Submit sends only the valid cell', async () => {
    const puts = []
    store({
      drafts: { [`m1|${TUE}`]: '9', [`m9|${TUE}`]: '5', [`m3|${TUE}`]: '4' },
      notes: { [`m1|${TUE}`]: NOTE, [`m9|${WED}`]: NOTE, [`m3|${WED}`]: NOTE },
    })
    // Cutover keeps a saved entry on Wed, so its note button shows whether a note came back ("Edit") or not ("Add").
    const held = entry({ id: 'g', milestone_id: 'm3', project_id: 'p2', work_date: WED, hours: 3, note: '' })
    server.use(sheet({ rows: [build, mapping, cutover], entries: [entry(), held] }), recordPuts(puts))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(screen.getByLabelText('Cutover, Tue Oct 13')).toHaveValue('')
    expect(screen.getByLabelText('Cutover, Tue Oct 13')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add work note, Cutover, Wed Oct 14' })).toBeInTheDocument()
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: TUE, hours: 9, note: NOTE }] })
    await waitFor(() => expect(sessionStorage.getItem(KEY)).toBeNull())
  })

  test('a restored cell whose row a later refetch no longer lists leaves Submit and is never sent', async () => {
    const puts = []
    let listed = [build, mapping]
    const rejected = entry({ id: 'c', work_date: WED, status: 'rejected', label: 'Rejected', rejection_reason: REASON })
    store({ drafts: { [`m2|${TUE}`]: '3' }, notes: {} })
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json(body({ rows: listed, entries: [rejected] }))),
      recordPuts(puts))
    renderSheet()
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Build, Tue Oct 13')).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    // Build is unassigned; Save & resubmit on another cell refetches the week.
    listed = [mapping]
    await user.click(screen.getByRole('button', { name: 'Needs revision, details for Schema Mapping, Wed Oct 14' }))
    await user.click(within(await screen.findByRole('complementary', { name: 'Entry details' })).getByRole('button', { name: 'Save & resubmit' }))
    await waitFor(() => expect(screen.queryByLabelText('Build, Tue Oct 13')).not.toBeInTheDocument())
    expect(puts).toEqual([{ week: WEEK, entries: [{ milestone_id: 'm1', work_date: WED, hours: 8 }] }])
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
  })

  test.each([
    ['garbage JSON', '{"drafts": {"m1|2026-10-13": "9"'],
    ['null', 'null'],
    ['a list', '["m1|2026-10-13"]'],
    ['drafts as a string', '{"drafts": "9", "notes": 5}'],
    ['hours as numbers and malformed keys', '{"drafts": {"m1|2026-10-13": 9, "m1-2026-10-14": "3", "m1|2026-10-15": "1e1"}}'],
  ])('%s in the key restores nothing and the page renders', async (_, raw) => {
    const errors = vi.spyOn(console, 'error')
    store(raw)
    server.use(sheet())
    renderSheet()
    expect(await screen.findByRole('rowheader', { name: /schema mapping/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
    expect(errors).not.toHaveBeenCalled()
  })

  // Moving between weeks shows the previous week's sheet (placeholder data) until the new one arrives.
  const gatedWeeks = ({ prev = [build, mapping], current = [build, mapping] } = {}) => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    server.use(http.get(`${API}/time-entries`, async ({ request }) => {
      const week = new URL(request.url).searchParams.get('week')
      if (week === WEEK) {
        await gate
        return HttpResponse.json(body({ rows: current, entries: [] }))
      }
      return HttpResponse.json(body({ week, rows: prev, entries: [] }))
    }))
    return () => release()
  }

  test("stepping from the week of Oct 5 back to Oct 12 restores Oct 12's cells only once Oct 12's own data is in", async () => {
    store({ drafts: { [`m1|${TUE}`]: '9' }, notes: { [`m1|${TUE}`]: NOTE } })
    const release = gatedWeeks()
    renderSheet(`/timesheet?week=${PREV}`)
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Schema Mapping, Tue Oct 6')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    // Oct 12 is named, but the rows on screen are still Oct 5's.
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 12 – 18, 2026' })).toBeInTheDocument()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
    expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: { [`m1|${TUE}`]: NOTE } })
    release()
    await waitFor(() => expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9'))
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    expect(sessionStorage.getItem(PREV_KEY)).toBeNull()
  })

  test("nothing restores from the previous week's rows: a row Oct 12 no longer lists stays out of Submit", async () => {
    const puts = []
    store({ drafts: { [`m1|${TUE}`]: '9', [`m2|${WED}`]: '3' }, notes: {} })
    // Oct 5 still lists Schema Mapping; Oct 12's own sheet doesn't (it was unassigned).
    const release = gatedWeeks({ prev: [build, mapping], current: [build] })
    server.use(recordPuts(puts))
    renderSheet(`/timesheet?week=${PREV}`)
    const user = userEvent.setup()
    await screen.findByLabelText('Schema Mapping, Tue Oct 6')
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 12 – 18, 2026' })).toBeInTheDocument()
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('')
    release()
    await waitFor(() => expect(screen.queryByLabelText('Schema Mapping, Tue Oct 13')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Build, Wed Oct 14')).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ week: WEEK, entries: [{ milestone_id: 'm2', work_date: WED, hours: 3 }] })
  })

  test("leaving a week before its own data is in keeps that week's stored typing", async () => {
    store({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} })
    const release = gatedWeeks()
    renderSheet(`/timesheet?week=${PREV}`)
    const user = userEvent.setup()
    await screen.findByLabelText('Schema Mapping, Tue Oct 6')
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 12 – 18, 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 5 – 11, 2026' })).toBeInTheDocument()
    expect(stored()).toEqual({ drafts: { [`m1|${TUE}`]: '9' }, notes: {} })
    release()
  })

  test('with sessionStorage.setItem throwing, typing and Submit still work', async () => {
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function full(...args) {
      if (this === window.sessionStorage) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, args)
    })
    const errors = vi.spyOn(console, 'error')
    const puts = []
    server.use(sheet(), recordPuts(puts))
    renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9', NOTE)
    expect(screen.getByLabelText('Schema Mapping, Tue Oct 13')).toHaveValue('9')
    expect(screen.getByTestId('week-total')).toHaveTextContent('17h counted of 40h')
    await user.click(screen.getByRole('button', { name: 'Submit 1 change' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({ week: WEEK, entries: [{ milestone_id: 'm1', work_date: TUE, hours: 9, note: NOTE }] })
    expect(await screen.findByText('Hours saved and sent for approval')).toBeInTheDocument()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(errors).not.toHaveBeenCalled()
  })

  test('with sessionStorage blocked outright, the page renders and typing works', async () => {
    const blocked = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
    for (const method of ['getItem', 'setItem', 'removeItem', 'key']) {
      const real = Storage.prototype[method]
      vi.spyOn(Storage.prototype, method).mockImplementation(function maybe(...args) {
        return this === window.sessionStorage ? blocked() : real.apply(this, args)
      })
    }
    server.use(sheet())
    renderSheet()
    const user = userEvent.setup()
    await typeCell(user, 'Schema Mapping, Tue Oct 13', '9')
    expect(screen.getByRole('button', { name: 'Submit 1 change' })).toBeEnabled()
  })
})
