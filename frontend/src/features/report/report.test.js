import { describe, expect, test } from 'vitest'
import { buildReportHtml, escapeHtml, headline, reportDate, reportSubject } from './reportHtml.js'

const dashboard = {
  at_risk: [{ id: 'p1', name: 'Apollo <script>alert(1)</script>', reasons: ['OVERDUE_MILESTONE', 'BUDGET_BURN'] }],
  milestones: { overdue: [{ id: 'm1' }, { id: 'm2' }], due_soon: [] },
  pending_approvals: 3,
  budgets: [
    { project_id: 'p1', name: 'Apollo <script>alert(1)</script>', budget: 100000, consumed: 60000, forecast: 120000 },
    { project_id: 'p2', name: 'Zeus & "Sons"', budget: 50000, consumed: 10000, forecast: 40000 },
  ],
}
const insights = [
  { title: 'Eli <img src=x onerror=alert(1)> is over 40h', detail: 'Rebalance <b>now</b>', severity: 'high' },
  ...Array.from({ length: 6 }, (_, i) => ({ title: `Insight ${i}`, detail: 'd', severity: 'low' })),
]

describe('report html', () => {
  test('escapes every piece of text', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    const html = buildReportHtml({ dashboard, insights, scope: 'R&D <Lab>', preparedBy: 'Morgan <Manager>' })
    expect(html).not.toMatch(/<script|<img|<b>now/i)
    expect(html).toContain('Apollo &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Zeus &amp; &quot;Sons&quot;')
    expect(html).toContain('R&amp;D &lt;Lab&gt;')
    expect(html).toContain('prepared by Morgan &lt;Manager&gt;')
  })

  test('uses only tables and inline styles', () => {
    const html = buildReportHtml({ dashboard, insights })
    expect(html).not.toMatch(/<style|<script|<img|<link|class=/i)
    expect(html.startsWith('<table')).toBe(true)
  })

  test('has the headline, at-risk, insights and budget sections', () => {
    const html = buildReportHtml({ dashboard, insights, scope: 'Technology', date: new Date(2026, 9, 14) })
    for (const section of ['Delivery report', 'Headline', 'At-risk projects (1)', 'Top insights', 'Budget by project']) {
      expect(html).toContain(section)
    }
    expect(html).toContain('Oct 14, 2026 · Technology')
    expect(html).toContain('Overdue milestone, Budget burning faster than progress')
    expect(html).toContain('$120,000 (over budget)')
    expect(html).not.toContain('$40,000 (over budget)')
    // The risk words are bold, as on screen.
    expect(html).toContain('<strong>Overdue milestone, Budget burning faster than progress</strong>')
    expect(html).toContain('60%')  // Apollo's share used
    expect(html).toContain('Insight 3')
    expect(html).not.toContain('Insight 4')  // top five only
  })

  test('headline numbers add up across projects', () => {
    expect(headline(dashboard)).toEqual({ atRisk: 1, overdue: 2, pendingApprovals: 3, budget: 150000, consumed: 70000,
      budgetPct: (70000 / 150000) * 100 })
    expect(headline({})).toMatchObject({ atRisk: 0, overdue: 0, pendingApprovals: 0, budgetPct: 0 })
  })

  test('empty sections say so', () => {
    const html = buildReportHtml({ dashboard: { at_risk: [], milestones: { overdue: [] }, budgets: [], pending_approvals: 0 } })
    expect(html).toContain('Nothing is at risk')
    expect(html).toContain('No suggestions right now')
    expect(html).toContain('No budgets yet')
  })

  test('subject carries the date', () => {
    expect(reportDate(new Date(2026, 9, 14, 23, 30))).toBe('Oct 14, 2026')
    expect(reportSubject(new Date(2026, 9, 14))).toBe('Scout delivery report — Oct 14, 2026')
  })
})
