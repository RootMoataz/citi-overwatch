// The Week totals card counts the same cells as the grid (the shown week's listed rows), plus saved hours on rows the
// sheet no longer lists, which the server still counts toward the week and the 40h rule. While the next week loads
// (the previous week's data on show) it shows a skeleton, never figures from two weeks mixed.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const NEXT = '2026-10-19'
const MON = WEEK
const TUE = '2026-10-13'
const WED = '2026-10-14'
const THU = '2026-10-15'
const FRI = '2026-10-16'
const rows = [
  { milestone: { id: 'm1', name: 'Schema Mapping', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
  { milestone: { id: 'm2', name: 'Build', status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true },
]
const entry = (overrides) => ({ id: 'e1', milestone_id: 'm1', project_id: 'p1', work_date: MON, hours: 8, status: 'pending',
  over_40: false, edited_after_decision: false, rejection_reason: null, note: 'Mapped the customer tables', source: 'manual',
  tracked_hours: 0, label: 'Pending approval', ...overrides })
// The mockup's week: Mon 0.25, Tue 7.75 and Fri 7.75 approved; Thu 4 pending; Wed 8 rejected.
const mockEntries = [
  entry({ id: 'a', work_date: MON, hours: 0.25, status: 'approved' }),
  entry({ id: 'b', work_date: TUE, hours: 7.75, status: 'approved' }),
  entry({ id: 'c', work_date: WED, hours: 8, status: 'rejected', rejection_reason: 'Wrong milestone' }),
  entry({ id: 'd', work_date: THU, hours: 4, status: 'pending' }),
  entry({ id: 'f', work_date: FRI, hours: 7.75, status: 'approved' }),
]
// m9 is a milestone Eli logged on this week and has since been unassigned from: the sheet lists no row for it.
const unlisted = (overrides) => entry({ id: 'u', milestone_id: 'm9', project_id: 'p2', ...overrides })
// The server's totals: pending and approved hours of every entry of the week, listed row or not.
const totalsOf = (entries) => ({
  logged: entries.filter((e) => e.status !== 'rejected').reduce((s, e) => s + e.hours, 0),
  approved: entries.filter((e) => e.status === 'approved').reduce((s, e) => s + e.hours, 0),
  draft: 0,
})
const body = ({ week = WEEK, entries = mockEntries } = {}) => ({ week_start: week,
  user: { id: users.employee.id, name: 'Eli Employee' }, rows, entries, drafts: [], locks: [], totals: totalsOf(entries) })

const renderSheet = (route = `/timesheet?week=${WEEK}`) => renderAsUser(<TimesheetPage />,
  { user: users.employee, route, path: '/timesheet' })
const card = () => screen.getByRole('group', { name: 'Week totals' })
/** The card's three figures as { Approved, Pending, Needs revision }: each figure's hours sit beside its word. */
const figures = () => Object.fromEntries(within(card()).getAllByRole('listitem').map((li) => {
  const [hours, word] = [...li.querySelectorAll('span')].map((s) => s.textContent).filter(Boolean)
  return [word, hours]
}))

beforeEach(() => {
  localStorage.setItem('overwatch.timesheet.view', 'week')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => {
  server.events.removeAllListeners()
  vi.useRealTimers()
})

// The counted line once it shows exactly `text` (its number and words are two spans of one line).
const counted = (text) => waitFor(() => expect(screen.getByTestId('week-total').textContent.replace(/\s+/g, ' ').trim()).toBe(text))

describe('Week totals: the same cells as the grid', () => {
  test("while the next week loads, the card is a skeleton, never a negative Pending from the previous week's entries", async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    server.use(http.get(`${API}/time-entries`, async ({ request }) => {
      const week = new URL(request.url).searchParams.get('week')
      if (week === NEXT) {
        await gate
        return HttpResponse.json(body({ week: NEXT, entries: [] }))
      }
      return HttpResponse.json(body())
    }))
    renderSheet()
    const user = userEvent.setup()
    await counted('19.75h counted of 40h')
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Oct 19 – 25, 2026' })).toBeInTheDocument()
    // Oct 12's entries are still in memory, Oct 19's aren't in yet: no figures at all, and nothing negative.
    expect(card()).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('week-total')).not.toBeInTheDocument()
    expect(card()).not.toHaveTextContent(/-\d/)
    expect(screen.queryByText(/excluded until resubmitted/)).not.toBeInTheDocument()
    release()
    await counted('0h counted of 40h')
    expect(card()).not.toHaveAttribute('aria-busy')
    expect(figures()).toEqual({ Approved: '0h', Pending: '0h', 'Needs revision': '0h' })
  })

  test('approved hours on a milestone no longer assigned count toward the week, with a footnote, and Pending stays positive', async () => {
    // Listed: only Thu's 4h pending. Unlisted: 7.75h approved on m9.
    const entries = [entry({ id: 'd', work_date: THU, hours: 4, status: 'pending' }),
      unlisted({ work_date: TUE, hours: 7.75, status: 'approved' })]
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json(body({ entries }))))
    renderSheet()
    await counted('11.75h counted of 40h')
    expect(card()).toContainElement(screen.getByTestId('week-total'))
    expect(figures()).toEqual({ Approved: '7.75h', Pending: '4h', 'Needs revision': '0h' })
    expect(within(card()).getByText("Includes 7.75h on milestones you're no longer assigned to.")).toBeInTheDocument()
    // The grid still counts only its own rows.
    const daily = within(screen.getByRole('table')).getByRole('rowheader', { name: 'Daily total (counted)' }).closest('tr')
    expect(within(daily).getAllByRole('cell').at(-1)).toHaveTextContent(/^4h$/)
  })

  test('without unlisted hours there is no footnote', async () => {
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json(body())))
    renderSheet()
    await counted('19.75h counted of 40h')
    expect(screen.queryByText(/no longer assigned to/)).not.toBeInTheDocument()
  })

  test("with nothing typed the card equals the server's totals, unlisted rows and a rejected unlisted entry included", async () => {
    const entries = [...mockEntries,
      unlisted({ id: 'u1', work_date: MON, hours: 2, status: 'pending' }),
      unlisted({ id: 'u2', work_date: TUE, hours: 3, status: 'approved' }),
      unlisted({ id: 'u3', work_date: WED, hours: 5, status: 'rejected', rejection_reason: 'Wrong milestone' })]
    const { logged, approved } = totalsOf(entries)
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json(body({ entries }))))
    renderSheet()
    expect(await screen.findByTestId('week-total')).toHaveTextContent(`${logged}h counted of 40h`)
    expect(figures()).toMatchObject({ Approved: `${approved}h`, Pending: `${logged - approved}h` })
    expect(within(card()).getByText("Includes 5h on milestones you're no longer assigned to.")).toBeInTheDocument()
  })

  test('typing on a listed cell moves the card the same way as the grid, never below zero', async () => {
    server.use(http.get(`${API}/time-entries`, () => HttpResponse.json(body({ entries: [
      entry({ id: 'b', work_date: TUE, hours: 7.75, status: 'approved' }), unlisted({ work_date: WED, hours: 6, status: 'approved' })] }))))
    renderSheet()
    const user = userEvent.setup()
    const tue = await screen.findByLabelText('Schema Mapping, Tue Oct 13')
    expect(screen.getByTestId('week-total')).toHaveTextContent('13.75h counted of 40h')
    await user.clear(tue)
    await user.type(tue, '2')
    // Tue's approved 7.75h is being changed to 2h: pending until approved again; m9's 6h stay approved.
    expect(screen.getByTestId('week-total')).toHaveTextContent('8h counted of 40h')
    expect(figures()).toEqual({ Approved: '6h', Pending: '2h', 'Needs revision': '0h' })
    await waitFor(() => expect(card()).not.toHaveTextContent(/-\d/))
  })
})
