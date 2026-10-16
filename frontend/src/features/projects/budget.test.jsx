import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import ProjectDetailPage from './ProjectDetailPage.jsx'

const project = (o = {}) => ({
  id: 'p1', name: 'Apollo Data Migration', description: 'Move records', status: 'active',
  start_date: '2026-01-01', predicted_end_date: '2026-12-31', budget: 250000, consumed: 21745,
  budget_pct: 8.7, progress_pct: 33.3, at_risk_reasons: [], is_archived: false, completed_at: null,
  manager: { id: users.manager.id, name: 'Morgan Manager' }, ...o,
})

const costs = (hoursVisible = true) => ({
  hours_visible: hoursVisible,
  items: [
    { milestone: { id: 'm1', name: 'Schema Mapping', status: 'completed' }, approved_hours: hoursVisible ? 600 : null,
      pending_hours: hoursVisible ? 12 : null, approved_cost: 30000, budget_pct: 12 },
    { milestone: { id: 'm2', name: 'Cutover', status: 'in_progress' }, approved_hours: hoursVisible ? 400 : null,
      pending_hours: hoursVisible ? 0 : null, approved_cost: 20000, budget_pct: 8 }],
  total: { approved_hours: hoursVisible ? 1000 : null, pending_hours: hoursVisible ? 12 : null, approved_cost: 50000, budget_pct: 20 },
})

const pendingItem = (id, hours) => ({ entry: { id, hours, status: 'pending', project_id: 'p1' }, user: { id: 'u-ada', name: 'Ada Lovelace' },
  milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo Data Migration' }, flags: [] })

function open({ p = project(), summary = {}, who = users.manager, hoursVisible = true, pending = [pendingItem('e1', 40), pendingItem('e2', 22)] } = {}) {
  const requested = []
  server.use(
    http.get(`${API}/projects/${p.id}`, () => HttpResponse.json(p)),
    http.get(`${API}/projects/${p.id}/summary`, () => HttpResponse.json({ project: p, budget: p.budget, consumed: p.consumed,
      remaining: p.budget - p.consumed, forecast: 61293, budget_pct: p.budget_pct, progress_pct: p.progress_pct,
      at_risk_reasons: [], member_count: 1, ...summary })),
    http.get(`${API}/projects/${p.id}/milestone-costs`, () => HttpResponse.json(costs(hoursVisible))),
    http.get(`${API}/projects/${p.id}/members`, () => HttpResponse.json([])),
    http.get(`${API}/approvals`, () => { requested.push('approvals'); return HttpResponse.json(pending) }))
  renderAsUser(<ProjectDetailPage />, { user: who, route: '/projects/p1?tab=budget', path: '/projects/:id' })
  return requested
}

const kpis = () => screen.findByRole('group', { name: 'Budget figures' })
const toneOf = (strip, label) => within(strip).getByText(label).closest('[data-tone]')

describe('Budget tab', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T15:00:00Z')) })
  afterEach(() => vi.useRealTimers())

  test('KPI strip: Budget, Approved spend, Available budget, Forecast at completion', async () => {
    open()
    const strip = await kpis()
    await within(strip).findByText('$61,293')
    for (const l of ['Budget', 'Approved spend', 'Available budget', 'Forecast at completion']) expect(within(strip).getByText(l)).toBeInTheDocument()
    expect(within(strip).getByText('$250,000')).toBeInTheDocument()
    expect(within(strip).getByText('$21,745')).toBeInTheDocument()
    expect(within(strip).getByText('$228,255')).toBeInTheDocument()
    expect(toneOf(strip, 'Forecast at completion')).toBeNull()
  })

  test('over budget: Available budget says so', async () => {
    open({ p: project({ consumed: 262000, budget_pct: 104.8 }), summary: { forecast: 300000 } })
    const strip = await kpis()
    expect(await within(strip).findByText('$12,000 over budget')).toBeInTheDocument()
  })

  test('forecast above the budget is in the warning tone', async () => {
    open({ summary: { forecast: 261000 } })
    const strip = await kpis()
    await within(strip).findByText('$261,000')
    expect(toneOf(strip, 'Forecast at completion')).toHaveAttribute('data-tone', 'warning')
  })

  test('Spend and forecast: subtitle, legend, text alternative, print and caption', async () => {
    open()
    const card = (await screen.findByRole('heading', { level: 2, name: 'Spend and forecast' })).closest('section')
    expect(await within(card).findByText('8.7% approved spend · 24.5% forecast')).toBeInTheDocument()
    expect(within(card).getAllByText('Approved spend').length).toBeGreaterThan(0)
    expect(within(card).getAllByText('Forecast at completion').length).toBeGreaterThan(0)
    const bullet = within(card).getByRole('list', { name: /approved spend against budget/i })
    expect(within(bullet).getByRole('listitem')).toHaveAccessibleName(/^Budget \$250,000\. Approved spend \$21,745 \(8\.7%\)\. Forecast at completion \$61,293/)
    expect(screen.getByRole('button', { name: 'Print / PDF' })).toBeInTheDocument()
    expect(within(card).getByText('Forecast projects the last 4 weeks of approved spending to the project end date.')).toBeInTheDocument()
  })

  test('manager sees the pending banner linking to the timesheets', async () => {
    open()
    expect(await screen.findByText('62h awaiting approval · Not yet included in spend.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review pending hours →' })).toHaveAttribute('href', '/timesheets?project=p1')
  })

  test('no banner when nothing is pending', async () => {
    open({ pending: [] })
    await screen.findByRole('table', { name: /cost by milestone/i })
    expect(screen.queryByText(/awaiting approval/)).not.toBeInTheDocument()
  })

  test('Cost by milestone: columns, total row, Export CSV, caption and footer', async () => {
    open()
    const table = await screen.findByRole('table', { name: /cost by milestone/i })
    for (const c of ['Milestone', 'Approved hours', 'Pending hours', 'Approved cost', 'Share of project budget'])
      expect(within(table).getByRole('columnheader', { name: c })).toBeInTheDocument()
    const row = within(table).getByText(/schema mapping/i).closest('tr')
    expect(within(row).getByText('600h')).toBeInTheDocument()
    expect(within(row).getByText('$30,000')).toBeInTheDocument()
    const total = within(table).getByRole('rowheader', { name: /total/i }).closest('tr')
    expect(within(total).getByText('$50,000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument()
    expect(screen.getByText("Bars compare the milestones; the percent is each one's share of the budget.")).toBeInTheDocument()
    expect(screen.getByText(/Displayed costs are rounded; totals use underlying values\. Approved spend uses the rate saved at approval\. Pending entries remain uncosted until approved\./)).toBeInTheDocument()
    expect(screen.getByText('As of Oct 15, 2026')).toBeInTheDocument()
  })

  describe('the bars', () => {
    const fillWidth = (meter) => parseFloat(getComputedStyle(meter.firstChild).width)
    async function table() { open(); return screen.findByRole('table', { name: /cost by milestone/i }) }

    test("the most expensive milestone's bar is full and the others are relative", async () => {
      const t = await table()
      const big = within(t).getByRole('meter', { name: /schema mapping share of budget/i })
      const small = within(t).getByRole('meter', { name: /cutover share of budget/i })
      expect(big).toHaveAttribute('aria-valuemax', '12')
      expect(fillWidth(big)).toBeCloseTo(100, 1)
      expect(fillWidth(small)).toBeCloseTo((8 / 12) * 100, 1)
    })

    test('the bar sits in the Approved cost cell and the Share cell reads the percent', async () => {
      const t = await table()
      const row = within(t).getByText(/cutover/i).closest('tr')
      const cells = within(row).getAllByRole('cell')
      const cost = cells.find((c) => within(c).queryByText('$20,000'))
      expect(within(cost).getByRole('meter', { name: /cutover share of budget/i })).toHaveAttribute('aria-valuetext', '8%')
      expect(cells.at(-1)).toHaveTextContent(/^8%$/)
    })
  })

  test('employee: no hours columns, no banner, no /approvals request, same dollars', async () => {
    const requested = open({ who: users.employee, hoursVisible: false })
    const table = await screen.findByRole('table', { name: /cost by milestone/i })
    expect(within(table).queryByRole('columnheader', { name: /hours/i })).not.toBeInTheDocument()
    expect(within(table).getByText('$20,000')).toBeInTheDocument()
    expect(within(await kpis()).getByText('$21,745')).toBeInTheDocument()
    expect(screen.queryByText(/awaiting approval/)).not.toBeInTheDocument()
    expect(requested).toEqual([])
  })

  test('executive: hours columns, no banner, no /approvals request', async () => {
    const requested = open({ who: users.executive })
    const table = await screen.findByRole('table', { name: /cost by milestone/i })
    expect(within(table).getByRole('columnheader', { name: 'Pending hours' })).toBeInTheDocument()
    expect(screen.queryByText(/awaiting approval/)).not.toBeInTheDocument()
    expect(requested).toEqual([])
  })

  test('never shows a rate figure', async () => {
    open()
    await screen.findByRole('table', { name: /cost by milestone/i })
    const tab = screen.getByRole('tabpanel')
    expect(within(tab).queryByText(/hourly|per hour|\/h\b|\$\d+(\.\d+)?\/hr/i)).not.toBeInTheDocument()
    // The spec's own footer mentions "the rate saved at approval"; no other text in the tab does.
    const rateTexts = Array.from(tab.querySelectorAll('*')).filter((n) => n.children.length === 0 && /rate/i.test(n.textContent))
    expect(rateTexts.map((n) => n.textContent).every((t) => /rate saved at approval/.test(t))).toBe(true)
  })

  test('phone: cost by milestone is stacked cards with labelled values, bars and a Total card', async () => {
    setViewport(375)
    open()
    expect(await screen.findByRole('heading', { level: 2, name: 'Cost by milestone' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: /cost by milestone/i })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(3)
    const first = cards[0]
    expect(first.textContent.indexOf('Schema Mapping')).toBeLessThan(first.textContent.indexOf('Approved hours'))
    for (const l of ['Approved hours:', 'Pending hours:', 'Approved cost:', 'Share of project budget:']) expect(within(first).getByText(l)).toBeInTheDocument()
    expect(within(first).getByText('600h')).toBeInTheDocument()
    expect(within(first).getByText('$30,000')).toBeInTheDocument()
    expect(within(first).getByRole('meter', { name: /schema mapping share of budget/i })).toHaveAttribute('aria-valuetext', '12%')
    const total = cards[2]
    expect(within(total).getByText('Total')).toBeInTheDocument()
    expect(within(total).getByText('$50,000')).toBeInTheDocument()
    expect(within(total).queryByRole('button')).not.toBeInTheDocument()
  })

  test('phone, employee: no hours lines on the cards', async () => {
    setViewport(375)
    open({ who: users.employee, hoursVisible: false })
    const list = await screen.findByRole('list', { name: /cost by milestone/i })
    expect(within(list).queryByText(/hours:/)).not.toBeInTheDocument()
    expect(within(list).getAllByText('$20,000').length).toBeGreaterThan(0)
  })

  test('no budget: no NaN or Infinity anywhere, dashes instead', async () => {
    open({ p: project({ budget: 0, budget_pct: null }), summary: { budget: 0, remaining: -21745, budget_pct: null } })
    const subtitle = await screen.findByText('— approved spend · — forecast')
    expect(subtitle).toBeInTheDocument()
    await screen.findByRole('table', { name: /cost by milestone/i })
    expect(screen.getByRole('tabpanel').textContent).not.toMatch(/NaN|Infinity/)
  })
})
