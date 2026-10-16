import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
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
