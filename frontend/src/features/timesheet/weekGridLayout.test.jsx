// The Week grid's fixed Milestone column and its scroll cue. jsdom has no layout, so these pin the styles the browser
// uses (the end-to-end phone check in e2e/shell.spec.js taps through them with real sizes).
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
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
    // A 140 px column (the cell's 16 px padding each side included): 108 px of name.
    expect(name).toHaveStyle({ maxWidth: '108px', overflowWrap: 'anywhere' })
    expect(within(screen.getByRole('table')).getByRole('columnheader', { name: 'Milestone' })).toHaveStyle({ minWidth: '140px' })
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
