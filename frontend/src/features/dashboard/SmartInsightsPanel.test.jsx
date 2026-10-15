import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import SmartInsightsPanel from './SmartInsightsPanel.jsx'

const insights = [
  { id: 'budget_overrun:p1', kind: 'budget_overrun', severity: 'high', title: 'Apollo is heading over budget',
    detail: 'Apollo is forecast to finish $12,346 over budget ($262,346 forecast vs $250,000 budget).',
    link: { to: 'project', id: 'p1' } },
  { id: 'milestone_due_soon:m2', kind: 'milestone_due_soon', severity: 'medium', title: 'Launch is due soon',
    detail: 'Launch (Apollo) is due in 3 days and hasn\'t started.', link: { to: 'project', id: 'p1', tab: 'milestones' } },
  { id: 'approval_backlog:pending', kind: 'approval_backlog', severity: 'medium', title: 'Approvals are piling up',
    detail: '2 time entries are waiting for approval from more than 3 days ago (the oldest is 7 days old).',
    link: { to: 'approvals' } },
  { id: 'rejections:u-ana', kind: 'rejections', severity: 'low', title: 'Ana Ruiz keeps getting hours rejected',
    detail: 'Ana Ruiz has had 2 time entries rejected in the last 30 days.', link: { to: 'person', id: 'u-ana' } },
]

const render = (body, status = 200) => {
  server.use(http.get(`${API}/insights/smart`, () => HttpResponse.json(body, { status })))
  return renderAsUser(<SmartInsightsPanel />, { user: users.manager, route: '/dashboard-under-test' })
}

describe('SmartInsightsPanel', () => {
  test('is labelled as rule-based and shows each insight with its severity, detail and link', async () => {
    render(insights)
    const panel = await screen.findByRole('region', { name: 'Smart insights' })
    expect(within(panel).getByText('Rule-based suggestions from your live data')).toBeInTheDocument()
    const rows = await within(panel).findAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]).getByText('High')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Apollo is heading over budget')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/forecast to finish \$12,346 over budget/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('Medium')).toBeInTheDocument()
    expect(within(rows[3]).getByText('Low')).toBeInTheDocument()
    const hrefs = rows.map((row) => within(row).getByRole('link').getAttribute('href'))
    expect(hrefs).toEqual(['/projects/p1', '/projects/p1?tab=milestones', '/approvals', '/people/u-ana/profile'])
    expect(within(rows[2]).getByRole('link')).toHaveAccessibleName('Review approvals')
  })

  test('says so when there is nothing to suggest', async () => {
    render([])
    const panel = await screen.findByRole('region', { name: 'Smart insights' })
    expect(await within(panel).findByText('No suggestions right now')).toBeInTheDocument()
    expect(within(panel).queryAllByRole('listitem')).toHaveLength(0)
  })

  test('asks for every department when none is picked', async () => {
    const asked = []
    server.use(http.get(`${API}/insights/smart`, ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('department'))
      return HttpResponse.json([])
    }))
    renderAsUser(<SmartInsightsPanel />, { user: users.manager, route: '/dashboard-under-test' })
    expect(await screen.findByText('No suggestions right now')).toBeInTheDocument()
    expect(asked).toEqual([null])
  })

  test('asks for the department it is given, and for everything without one', async () => {
    const asked = []
    server.use(http.get(`${API}/insights/smart`, ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('department'))
      return HttpResponse.json(insights)
    }))
    renderAsUser(<SmartInsightsPanel department="d1" />, { user: users.manager, route: '/dashboard-under-test' })
    expect(await screen.findAllByRole('listitem')).toHaveLength(4)
    expect(asked).toEqual(['d1'])
  })

  test('shows an error with a retry when the insights fail to load', async () => {
    render({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
    const panel = await screen.findByRole('region', { name: 'Smart insights' })
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Internal server error')
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
