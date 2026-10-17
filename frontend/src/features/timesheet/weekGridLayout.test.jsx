// The Week grid's fixed Milestone column and its scroll cue. jsdom has no layout, so these pin the styles the browser
// uses (the end-to-end phone check in e2e/shell.spec.js taps through them with real sizes).
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { expectPhoneTarget } from '../../test/cssRules.js'
import { setPrefersDark, setViewport } from '../../test/setup.js'
import TimesheetPage from './TimesheetPage.jsx'

const WEEK = '2026-10-12'
const LONG = 'Apollo Schema Mapping and Cross-Region Customer Ledger Consolidation Wolfeschlegelsteinhausenbergerdorff'
const open = { milestone: { id: 'm1', name: LONG, status: 'in_progress' }, project: { id: 'p1', name: 'Apollo', status: 'active' }, open: true }
const onHold = { milestone: { id: 'm3', name: 'Cutover', status: 'in_progress' }, project: { id: 'p2', name: 'Atlas', status: 'on_hold' }, open: false }
const sheet = () => http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
  user: { id: users.employee.id, name: 'Eli Employee' }, rows: [open, onHold], entries: [], drafts: [], locks: [],
  totals: { logged: 0, approved: 0, draft: 0 } }))
const renderSheet = () => renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}`, path: '/timesheet' })

beforeEach(() => {
  localStorage.setItem('overwatch.timesheet.view', 'week')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('the Week grid on a phone', () => {
  test('a very long name wraps inside the capped Milestone column and is still read in full', async () => {
    setViewport(375)
    server.use(sheet())
    renderSheet()
    const header = await screen.findByRole('rowheader', { name: new RegExp(LONG) })
    const name = within(header).getByText(LONG)
    // A 104 px column (the cell's 8 px padding each side included): 88 px of name.
    expect(name).toHaveStyle({ maxWidth: '88px', overflowWrap: 'anywhere' })
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Milestone' })).toHaveStyle({ minWidth: '104px' })
  })

  test("a closed row's fixed first cell carries the row's tint over its opaque background", async () => {
    server.use(sheet())
    renderSheet()
    const closed = await screen.findByRole('rowheader', { name: /^Cutover/ })
    expect(closed.closest('tr')).toHaveAttribute('aria-disabled', 'true')
    expect(getComputedStyle(closed).backgroundImage).toMatch(/linear-gradient/)
    expect(getComputedStyle(screen.getByRole('rowheader', { name: new RegExp(LONG) })).backgroundImage).not.toMatch(/linear-gradient/)
  })

  test('wider than its card, the grid fades at the right edge until scrolled to the end, never over the fixed column', async () => {
    server.use(sheet())
    renderSheet()
    const scroller = (await screen.findByRole('table')).closest('.MuiTableContainer-root')
    const size = (scrollLeft) => {
      Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 900 })
      Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 400 })
      Object.defineProperty(scroller, 'scrollLeft', { configurable: true, value: scrollLeft })
      fireEvent.scroll(scroller)
    }
    size(0)
    expect(document.querySelector('[data-scroll-fade="right"]')).toBeInTheDocument()
    size(300)
    expect(document.querySelector('[data-scroll-fade="right"]')).toBeInTheDocument()
    expect(document.querySelector('[data-scroll-fade="left"]')).not.toBeInTheDocument()
    size(500)
    expect(document.querySelector('[data-scroll-fade]')).not.toBeInTheDocument()
  })
})

describe('the Week grid on a phone: the Milestone column stays in view and about 3 days show', () => {
  test('every first-column cell is sticky and opaque (dark too), the day columns are 60 px, the buttons wrap in 44 px targets', async () => {
    setViewport(375)
    setPrefersDark(true)
    server.use(sheet())
    renderSheet()
    const row = await screen.findByRole('rowheader', { name: new RegExp(LONG) })
    const table = screen.getByRole('table')
    const head = within(table).getByRole('columnheader', { name: 'Milestone' })
    const total = within(table).getByRole('rowheader', { name: 'Daily total (counted)' })
    ;[head, row, total].forEach((cell) => {
      expect(cell).toHaveStyle({ position: 'sticky', left: '0px' })
      expect(Number(getComputedStyle(cell).zIndex)).toBeGreaterThan(0)
      expect(getComputedStyle(cell).backgroundColor).not.toBe('')
    })
    expect(within(table).getAllByRole('columnheader').find((c) => /^Mon/.test(c.textContent))).toHaveStyle({ minWidth: '60px' })
    const start = screen.getByRole('button', { name: `Start timer on ${LONG}` })
    const manual = screen.getByRole('button', { name: `Log hours manually on ${LONG}` })
    ;[start, manual].forEach((b) => { expect(b).toHaveStyle({ whiteSpace: 'normal' }); expectPhoneTarget(b) })
    expectPhoneTarget(screen.getAllByRole('textbox', { name: new RegExp(LONG) })[0].closest('.MuiTextField-root'), 'min-height', { within: ' .MuiOutlinedInput-root' })
  })

  test("a running timer's Stop button shrinks to fit the narrow column and stays a 44 px target", async () => {
    setViewport(375)
    server.use(sheet(), http.get(`${API}/timers/current`, () => HttpResponse.json({ now: '2026-10-15T16:00:00.000Z', stopped: null, limits: [],
      timer: { id: 't1', milestone: { id: 'm1', name: LONG }, project: { id: 'p1', name: 'Apollo' }, work_date: '2026-10-15',
        started_at: '2026-10-15T15:00:00.000Z', stopped_at: null, auto_stopped: false, tracked_hours: 0, submitted: false, note: '' } })))
    renderSheet()
    const stop = await screen.findByRole('button', { name: new RegExp(`^Stop timer on ${LONG}`) })
    expect(stop).toHaveStyle({ minWidth: '0px', paddingLeft: '4px', paddingRight: '4px' })
    expectPhoneTarget(stop)
  })

  test('Submit and the Day / Week / Month buttons are 44 px targets', async () => {
    setViewport(375)
    server.use(sheet())
    renderSheet()
    await screen.findByRole('rowheader', { name: new RegExp(LONG) })
    expectPhoneTarget(screen.getByRole('button', { name: 'Submit' }))
    const view = screen.getByRole('group', { name: 'Timesheet view' })
    expectPhoneTarget(view, 'min-height', { within: ' .MuiToggleButton-root' })   // the group's rule sets it on its buttons
    expect(within(view).getAllByRole('button')).toHaveLength(3)
  })

  test('at desktop width the Milestone column and its buttons are as before', async () => {
    server.use(sheet())
    renderSheet()
    await screen.findByRole('rowheader', { name: new RegExp(LONG) })
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Milestone' })).toHaveStyle({ minWidth: '140px' })
    expect(screen.getByRole('button', { name: `Start timer on ${LONG}` })).toHaveStyle({ whiteSpace: 'nowrap' })
    expect(screen.getByRole('button', { name: `Log hours manually on ${LONG}` })).toHaveStyle({ whiteSpace: 'nowrap' })
  })
})

describe('the Week grid: header, project band and weekends', () => {
  test('the fixed Milestone header carries the header tint over its opaque background, like the day headers', async () => {
    server.use(sheet())
    renderSheet()
    const header = within(await screen.findByRole('table')).getByRole('columnheader', { name: 'Milestone' })
    expect(getComputedStyle(header).backgroundImage).toMatch(/linear-gradient\(rgb\(247, 249, 251\)/)
  })

  test("the project band is one header cell across the row, its name on one line (never wrapping in the first column)", async () => {
    server.use(sheet())
    renderSheet()
    const band = await screen.findByRole('rowheader', { name: 'Apollo' })
    expect(band).toHaveAttribute('colspan', '9')   // Milestone, 7 days, Counted
    const name = within(band).getByText('Apollo')
    expect(name).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis' })
    expect(name).toHaveAttribute('title', 'Apollo')
    expect(name.parentElement).toHaveStyle({ position: 'sticky' })   // it stays in view as the days scroll
  })

  test('weekend columns are tinted 6%, and their empty inputs dimmed; a weekday input is not', async () => {
    server.use(sheet())
    renderSheet()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: /^Sat/ })).toHaveStyle({ backgroundColor: 'rgba(17, 28, 39, 0.06)' })
    const sat = within(table).getByLabelText(`${LONG}, Sat Oct 17`)
    const mon = within(table).getByLabelText(`${LONG}, Mon Oct 12`)
    expect(sat.parentElement).toHaveAttribute('data-dim')
    expect(mon.parentElement).not.toHaveAttribute('data-dim')
  })
})

describe('the Week grid beside an open Entry details panel', () => {
  const entry = { id: 'e1', milestone_id: 'm1', work_date: '2026-10-14', hours: '4', status: 'pending', note: 'Mapped the source tables.',
    source: 'manual', over_40: false, edited_after_decision: false }
  const withEntry = () => http.get(`${API}/time-entries`, () => HttpResponse.json({ week_start: WEEK,
    user: { id: users.employee.id, name: 'Eli Employee' }, rows: [open, onHold], entries: [entry], drafts: [], locks: [],
    totals: { logged: 4, approved: 0, draft: 0 } }))

  // The milestone column sets the grid's width; Log hours manually wraps beside the panel so all seven days and Counted fit.
  test('Log hours manually may wrap onto two lines so the Milestone column stays narrow', async () => {
    server.use(withEntry())
    renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}&entry=m1:2026-10-14`, path: '/timesheet' })
    const button = await screen.findByRole('button', { name: `Log hours manually on ${LONG}` })
    expect(await screen.findByRole('complementary', { name: 'Entry details' })).toBeInTheDocument()
    expect(button).toHaveStyle({ whiteSpace: 'normal' })
  })

  test('Start timer stays on one line beside the panel on a desktop (only a phone wraps it)', async () => {
    server.use(withEntry())
    renderAsUser(<TimesheetPage />, { user: users.employee, route: `/timesheet?week=${WEEK}&entry=m1:2026-10-14`, path: '/timesheet' })
    const start = await screen.findByRole('button', { name: `Start timer on ${LONG}` })
    expect(await screen.findByRole('complementary', { name: 'Entry details' })).toBeInTheDocument()
    expect(start).toHaveStyle({ whiteSpace: 'nowrap' })
  })

  test('with no panel open it stays on one line', async () => {
    server.use(withEntry())
    renderSheet()
    expect(await screen.findByRole('button', { name: `Log hours manually on ${LONG}` })).toHaveStyle({ whiteSpace: 'nowrap' })
  })
})
