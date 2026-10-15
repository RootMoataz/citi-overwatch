import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ProjectsPage from '../features/projects/ProjectsPage.jsx'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderAsUser, users } from '../test/render.jsx'

const project = (overrides) => ({ id: 'p1', name: 'Apollo', status: 'active', progress_pct: 33.3, budget_pct: 20,
  budget: '250000.00', consumed: '50000.00', start_date: '2026-01-05', predicted_end_date: '2026-12-31', at_risk_reasons: [],
  manager: { id: 'u-mgr', name: 'Morgan Manager' }, team: [{ id: 'u-emp', name: 'Eli Employee' }], ...overrides })

let blobs
let clicked
beforeEach(() => {
  blobs = []
  clicked = []
  URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:csv' })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicked.push(this.download) })
})
afterEach(() => vi.restoreAllMocks())

test('Export CSV downloads the projects the filters show, with readable headers, plain numbers and ISO dates', async () => {
  const asked = []
  server.use(http.get(`${API}/projects`, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')
    asked.push(status)
    return HttpResponse.json(status === 'active'
      ? { items: [project({ name: '=Atlas, "beta"', at_risk_reasons: ['PAST_DUE'] })], total: 1 }
      : { items: [project(), project({ id: 'p2', name: 'Beacon', status: 'on_hold' })], total: 2 })
  }))
  renderAsUser(<ProjectsPage />, { user: users.employee, route: '/projects?status=active' })
  await screen.findByText('=Atlas, "beta"')
  await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

  expect(clicked).toEqual([expect.stringMatching(/^overwatch-projects-\d{4}-\d{2}-\d{2}\.csv$/)])
  const text = await blobs[0].text()
  expect(blobs[0].type).toBe('text/csv;charset=utf-8')
  expect(new Uint8Array(await blobs[0].arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xEF, 0xBB, 0xBF]))
  // Blob.text() decodes UTF-8 and drops the BOM checked above.
  const [header, row, end] = text.split(String.fromCharCode(13, 10))
  expect(header).toBe('Project,Status,Manager,Department,Team,Progress (%),Budget (USD),Consumed (USD),Budget used (%),'
    + 'Start date,Due date,At risk')
  expect(row).toBe(`"'=Atlas, ""beta""",Active,Morgan Manager,,Eli Employee,33.3,250000,50000,20,2026-01-05,2026-12-31,Past due date`)
  expect(end).toBe('')
  await waitFor(() => expect(asked).toContain('active'))
})

test('Export CSV is disabled while there is nothing to export', async () => {
  server.use(http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })))
  renderAsUser(<ProjectsPage />, { user: users.employee, route: '/projects' })
  await screen.findByText(/aren't on any projects yet/)
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
})
