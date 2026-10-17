// The critical details are bold app-wide: lateness, limits, waiting statuses, risk and urgent priority. They are found by
// the `strong` role with the shared `bold` helper (test/bold.js, which says why).
import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { bold } from '../test/bold.js'
import { renderWithProviders } from '../test/render.jsx'
import Critical, { CriticalIn } from './Critical.jsx'
import PriorityChip from './PriorityChip.jsx'
import RiskBadges from './RiskBadges.jsx'
import RiskText from './RiskText.jsx'
import StatusChip from './StatusChip.jsx'

const boldTexts = () => bold(document.body)

describe('Critical', () => {
  test('renders its text in a strong element at weight 700', () => {
    renderWithProviders(<p>Due Oct 8 · <Critical>8 days overdue</Critical></p>)
    const strong = screen.getByRole('strong')
    expect(strong.tagName).toBe('STRONG')
    expect(strong).toHaveTextContent('8 days overdue')
    expect(strong).toHaveStyle({ fontWeight: '700' })
  })

  test('layout styles pass through, but the weight stays bold', () => {
    renderWithProviders(<p><Critical sx={{ flexShrink: 0, fontWeight: 400 }}>⚠ Overdue</Critical></p>)
    expect(screen.getByRole('strong')).toHaveStyle({ flexShrink: '0', fontWeight: '700' })
  })

  test('CriticalIn bolds only the critical part of a line, and nothing when there is no part', () => {
    const { unmount } = renderWithProviders(<p><CriticalIn text="Due Oct 8, 2026 · 8 days overdue" part="8 days overdue" /></p>)
    expect(boldTexts()).toEqual(['8 days overdue'])
    unmount()
    renderWithProviders(<p><CriticalIn text="Due Oct 8, 2026" part={null} /></p>)
    expect(boldTexts()).toEqual([])
  })

  test("CriticalIn fails loudly in tests when the text doesn't hold the part: a typo must not drop the bold silently", () => {
    expect(() => CriticalIn({ text: 'Due Oct 8, 2026 · 8 days overdue', part: '8 day overdue' }))
      .toThrow(`CriticalIn: "8 day overdue" isn't in "Due Oct 8, 2026 · 8 days overdue"`)
    // No part at all is not a mistake: the line has nothing critical.
    expect(CriticalIn({ text: 'Due Oct 20, 2026', part: null })).toBe('Due Oct 20, 2026')
    expect(CriticalIn({ text: 'Due Oct 20, 2026', part: '' })).toBe('Due Oct 20, 2026')
  })

  test('CriticalIn bolds the last match, since a name comes before the status: "noncritical audit is critical…"', () => {
    renderWithProviders(<p><CriticalIn text="noncritical audit is critical and due tomorrow" part="critical" /></p>)
    const strong = screen.getByRole('strong')
    expect(strong.previousSibling.textContent).toBe('noncritical audit is ')
    expect(strong.nextSibling.textContent).toBe(' and due tomorrow')
  })
})

describe('chips carry their own bold, for the critical kinds only', () => {
  test('Critical and High priority are bold; Medium and Low are not', () => {
    renderWithProviders(<>
      {['critical', 'high', 'medium', 'low'].map((p) => <PriorityChip key={p} priority={p} />)}
    </>)
    expect(boldTexts()).toEqual(['Critical priority', 'High priority'])   // sentence case, as the Now card says it
    for (const name of ['Priority: Critical', 'Priority: High', 'Priority: Medium', 'Priority: Low']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument()
    }
  })

  test('kicked back and waiting states are bold; normal states and re-labelled chips are not', () => {
    renderWithProviders(<>
      {['blocked', 'waiting', 'completed', 'in_progress', 'not_started', 'pending', 'approved'].map((s) => <StatusChip key={s} status={s} />)}
      <StatusChip status="blocked" label="Archived" />
    </>)
    expect(boldTexts()).toEqual(['Blocked – needs review', 'Waiting on dependencies'])
  })

  test('every risk badge is bold; On track is not', () => {
    const { unmount } = renderWithProviders(<RiskBadges reasons={['PAST_DUE', 'BLOCKED_MILESTONE']} counts={{ BLOCKED_MILESTONE: 2 }} />)
    expect(boldTexts()).toEqual(['Past due date', 'Kicked back – needs review (2)'])
    unmount()
    renderWithProviders(<RiskBadges reasons={[]} />)
    expect(boldTexts()).toEqual([])
  })

  test("a project's risk word is bold in the Risk column and the health chip", () => {
    const project = { at_risk_reasons: ['BUDGET_BURN'], budget_pct: 80, progress_pct: 40 }
    renderWithProviders(<>
      <RiskText project={project} today="2026-10-16" />
      <RiskText project={project} today="2026-10-16" variant="chip" />
      <RiskText project={{ at_risk_reasons: [] }} today="2026-10-16" variant="chip" />
    </>)
    expect(screen.getAllByRole('img', { name: 'Risk: Budget ahead of progress' })).toHaveLength(2)
    expect(boldTexts()).toEqual(['Budget ahead of progress', 'Budget ahead of progress'])
  })
})
