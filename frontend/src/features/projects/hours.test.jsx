import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import MilestonePendingHours from '../approvals/MilestonePendingHours.jsx'
import HoursTab from './HoursTab.jsx'

const project = { id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31',
  manager: { id: users.manager.id, name: 'Morgan Manager' } }

describe('HoursTab', () => {
  test('shows logged and approved hours per person for the week', async () => {
    server.use(http.get(`${API}/allocations`, () => HttpResponse.json([
      { user: { id: 'u1', name: 'Ada Lovelace', job_title: 'Analyst' }, planned_total: 30, logged_total: 32, utilization_pct: 80,
        projects: [{ id: 'p1', name: 'Apollo', planned: 20, logged: 18, approved: 10 },
          { id: 'p2', name: 'Atlas', planned: 10, logged: 14, approved: 14 }] },
      { user: { id: 'u2', name: 'Bo Peep', job_title: 'Engineer' }, planned_total: 10, logged_total: 5, utilization_pct: 12.5,
        projects: [{ id: 'p2', name: 'Atlas', planned: 10, logged: 5, approved: 5 }] },
    ])))
    renderAsUser(<HoursTab project={project} manage user={users.manager} />, { user: users.manager, route: '/hours-under-test' })
    const row = (await screen.findByText('Ada Lovelace')).closest('tr')
    expect(within(row).getByText('20h')).toBeInTheDocument()
    expect(within(row).getByText('18h')).toBeInTheDocument()
    expect(within(row).getByText('10h')).toBeInTheDocument()
    expect(within(row).getByText('8h')).toBeInTheDocument()   // pending = logged − approved
    expect(screen.queryByText('Bo Peep')).not.toBeInTheDocument()   // not on this project
  })

  test('explains that only the project manager sees team hours', () => {
    renderAsUser(<HoursTab project={project} manage={false} user={users.employee} />, { user: users.employee, route: '/hours-under-test' })
    expect(screen.getByText(/only the project's manager/i)).toBeInTheDocument()
  })
})

describe('MilestonePendingHours', () => {
  test('lists the milestone pending hours with budget impact inside the milestone', async () => {
    server.use(
      http.get(`${API}/approvals`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('milestone')).toBe('m1')
        return HttpResponse.json([{ entry: { id: 'e1', hours: 9, work_date: '2026-10-16', over_40: true, edited_after_decision: false },
          label: 'Pending (Overtime requested from Eli Employee)', user: { id: 'u1', name: 'Eli Employee' },
          milestone: { id: 'm1', name: 'Schema Mapping' }, project: { id: 'p1', name: 'Apollo' }, week_logged_total: 45 }])
      }),
      http.get(`${API}/time-entries/e1/breakdown`, () => HttpResponse.json({ entry_id: 'e1', hours: 9, hourly_rate: 50,
        request_cost: 450, milestone_cost: 0, milestone_cost_after: 450, budget: 10000, consumed: 0, remaining: 10000,
        remaining_before: 10000, remaining_after: 9550, pct_of_remaining: 4.5, forecast: 450, forecast_over_budget: false, weeks_remaining: 10 })),
    )
    renderAsUser(<MilestonePendingHours milestone={{ id: 'm1', name: 'Schema Mapping' }} />, { user: users.manager, route: '/m' })
    expect(await screen.findByText('1 entry waiting for approval')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /budget impact/i }))
    expect(await screen.findByText('$450.00')).toBeInTheDocument()
  })

  test('renders nothing when nothing is pending', async () => {
    server.use(http.get(`${API}/approvals`, () => HttpResponse.json([])))
    const { container } = renderAsUser(<MilestonePendingHours milestone={{ id: 'm1', name: 'X' }} />, { user: users.manager, route: '/m' })
    await new Promise((r) => setTimeout(r, 50))
    expect(container.querySelector('[data-pending-hours]')).toBeNull()
  })
})
