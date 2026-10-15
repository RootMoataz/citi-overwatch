import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import ProjectStatusCard from './ProjectStatusCard.jsx'

const counts = { planned: 2, active: 3, on_hold: 1, completed: 4, archived: 2, total: 12 }

function renderCard(body = counts) {
  server.use(http.get(`${API}/projects/status-counts`, () => HttpResponse.json(body)))
  return renderAsUser(<ProjectStatusCard />, { user: users.admin, route: '/' })
}

describe('Projects by status card', () => {
  test('shows the total in the donut and every status with its count and share', async () => {
    renderCard()
    const card = screen.getByRole('region', { name: /projects by status/i })
    const donut = await within(card).findByRole('img', { name: /donut chart: 12 projects/i })
    expect(donut).toHaveAccessibleName(/planned 2, active 3, on hold 1, completed 4, archived 2/i)
    expect(donut).toHaveTextContent('12projects')
    const list = within(card).getByRole('list', { name: /projects per status/i })
    const rows = within(list).getAllByRole('link')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Planned: 2 projects, 16.7%', 'Active: 3 projects, 25%', 'On hold: 1 project, 8.3%',
      'Completed: 4 projects, 33.3%', 'Archived: 2 projects, 16.7%'])
    await waitFor(() => expect(rows[1]).toHaveTextContent('Active3· 25%'))
    expect(rows[3]).toHaveTextContent('Completed4· 33.3%')
  })

  test('each status links to its filtered list; archived goes to the archive filtered to projects', async () => {
    renderCard()
    const link = async (name) => screen.findByRole('link', { name })
    expect(await link(/^planned:/i)).toHaveAttribute('href', '/projects?status=planned')
    expect(await link(/^active:/i)).toHaveAttribute('href', '/projects?status=active')
    expect(await link(/^on hold:/i)).toHaveAttribute('href', '/projects?status=on_hold')
    expect(await link(/^completed:/i)).toHaveAttribute('href', '/projects?status=completed')
    expect(await link(/^archived:/i)).toHaveAttribute('href', '/archive?type=project')
    await userEvent.click(await link(/^on hold:/i))
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?status=on_hold')
  })

  test('zero projects shows an empty state instead of a chart', async () => {
    renderCard({ planned: 0, active: 0, on_hold: 0, completed: 0, archived: 0, total: 0 })
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /donut chart/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /projects per status/i })).not.toBeInTheDocument()
  })

  test('a failed load says so with a retry', async () => {
    server.use(http.get(`${API}/projects/status-counts`,
      () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'Boom' } }, { status: 500 })))
    renderAsUser(<ProjectStatusCard />, { user: users.admin, route: '/' })
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
  })
})
