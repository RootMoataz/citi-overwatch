import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { COLOR_MODE_KEY } from '../../app/colorMode.js'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import ProjectsPage from '../projects/ProjectsPage.jsx'
import RequestsPage from '../requests/RequestsPage.jsx'
import PaletteButton from './PaletteButton.jsx'
import { typingIn } from './search.js'

const projects = [
  { id: 'p-apollo', name: 'Apollo', status: 'active', at_risk_reasons: [], department: { id: 'd-tech', name: 'Technology' },
    manager: { id: users.manager.id, name: 'Morgan Manager' }, progress_pct: 0, budget_pct: 0 },
  { id: 'p-zeus', name: 'Zeus', status: 'on_hold', at_risk_reasons: [], manager: { id: users.manager.id, name: 'Morgan Manager' },
    progress_pct: 0, budget_pct: 0 },
]
const milestones = {
  'p-apollo': [{ id: 'm1', name: 'Schema Mapping', status: 'in_progress', end_date: '2020-01-31', priority: 'high' },
    { id: 'm2', name: 'Cutover', status: 'not_started', end_date: '2099-01-31', priority: 'critical' },
    { id: 'm3', name: 'Discovery', status: 'completed', end_date: '2020-01-01', priority: 'critical' }],
  'p-zeus': [],
}

function handlers({ seenUsers = [] } = {}) {
  server.use(
    http.get(`${API}/projects`, () => HttpResponse.json({ items: projects, total: projects.length })),
    http.get(`${API}/projects/:id/milestones`, ({ params }) => HttpResponse.json(milestones[params.id] ?? [])),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd-tech', name: 'Technology', is_archived: false }] })),
    http.get(`${API}/users`, () => { seenUsers.push(true); return HttpResponse.json({ items: [
      { id: 'u-emp', first_name: 'Eli', last_name: 'Employee', job_title: 'Analyst' }], total: 1 }) }),
    http.get(`${API}/allocations`, () => HttpResponse.json([
      { user: { id: 'u-emp', name: 'Eli Employee', job_title: 'Analyst' }, projects: [], planned_total: 0, logged_total: 0, utilization_pct: 0 }])),
  )
}

const location = () => screen.getByTestId('location').textContent
const openWithShortcut = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

describe('command palette', () => {
  test('Ctrl+K opens it; a phrase shows its reading as a chip and Enter goes there', async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.admin, route: '/' })
    expect(screen.getByRole('button', { name: /search \((ctrl\+k|⌘k)\)/i })).toBeInTheDocument()
    openWithShortcut()
    const input = await screen.findByRole('combobox', { name: 'Search Scout' })
    await user.type(input, 'at-risk projects in Technology')
    expect(await screen.findByText('Projects · At risk · Technology')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/projects?at_risk=true&department=d-tech'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  test('results are grouped and keyboard navigable', async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.admin, route: '/' })
    await user.click(screen.getByRole('button', { name: /search/i }))
    const input = await screen.findByRole('combobox')
    await user.type(input, 'apollo')
    const list = screen.getByRole('listbox')
    await within(list).findByRole('option', { name: /^apollo/i })
    expect(within(list).getByText('Projects')).toBeInTheDocument()
    const options = within(list).getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/projects/p-apollo'))
  })

  test('arrow keys move the selection and wrap around', async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.admin, route: '/' })
    openWithShortcut()
    const input = await screen.findByRole('combobox')
    await user.type(input, 'schema')
    const option = await screen.findByRole('option', { name: /schema mapping/i })
    expect(option).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option').at(-1).id)
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(location()).toBe('/projects/p-apollo?tab=milestones'))
  })

  test('"/" opens it unless the focus is in a field', async () => {
    handlers()
    renderAsUser(<><input aria-label="Other field" /><PaletteButton /></>, { user: users.manager, route: '/' })
    fireEvent.keyDown(screen.getByLabelText('Other field'), { key: '/' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: '/' })
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
    expect(typingIn({ tagName: 'TEXTAREA' })).toBe(true)
    expect(typingIn({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(typingIn({ tagName: 'BUTTON' })).toBe(false)
  })

  test('overdue milestones lists only the overdue ones', async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.manager, route: '/projects' })
    openWithShortcut()
    await user.type(await screen.findByRole('combobox'), 'overdue milestones')
    expect(await screen.findByText('Dashboard · Overdue milestones')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /schema mapping/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /cutover/i })).not.toBeInTheDocument()
  })

  test('critical milestones lists only the open critical ones; high priority adds the high ones, most important first', async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.manager, route: '/projects' })
    openWithShortcut()
    const input = await screen.findByRole('combobox')
    await user.type(input, 'critical milestones')
    expect(await screen.findByText('Dashboard · Critical milestones')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /cutover/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /schema mapping/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /discovery/i })).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'high priority milestones')
    await screen.findByText('Dashboard · High priority milestones')
    await screen.findByRole('option', { name: /schema mapping/i })
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names.findIndex((n) => /cutover/i.test(n))).toBeLessThan(names.findIndex((n) => /schema mapping/i.test(n)))
    expect(names.some((n) => /discovery/i.test(n))).toBe(false)
  })

  test('dark mode switches the theme', async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.employee, route: '/' })
    openWithShortcut()
    await user.type(await screen.findByRole('combobox'), 'dark mode')
    expect(await screen.findByText('Theme · Dark')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark')
  })

  test('an employee is offered only what they may open and never lists everyone', async () => {
    const seenUsers = []
    handlers({ seenUsers })
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.employee, route: '/' })
    openWithShortcut()
    const input = await screen.findByRole('combobox')
    await user.type(input, 'a')
    await screen.findByRole('option', { name: /^apollo/i })
    expect(screen.queryByRole('option', { name: /^approvals$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /audit log/i })).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'pending approvals')
    expect(screen.queryByText('Approvals · Pending')).not.toBeInTheDocument()
    expect(seenUsers).toHaveLength(0)
  })

  test("a manager finds their own person's hours", async () => {
    handlers()
    const user = userEvent.setup()
    renderAsUser(<PaletteButton />, { user: users.manager, route: '/' })
    openWithShortcut()
    await user.type(await screen.findByRole('combobox'), "Eli's hours")
    expect(await screen.findByText('Eli Employee · Hours')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(location()).toBe('/people/u-emp/profile'))
  })
})

describe('pages honour the palette links', () => {
  test('the projects list filters by department from the URL and shows a removable chip', async () => {
    const seen = []
    server.use(
      http.get(`${API}/projects`, ({ request }) => { seen.push(Object.fromEntries(new URL(request.url).searchParams)); return HttpResponse.json({ items: [], total: 0 }) }),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd-tech', name: 'Technology', is_archived: false }] })),
    )
    const user = userEvent.setup()
    renderAsUser(<ProjectsPage />, { user: users.employee, route: '/projects?at_risk=true&department=d-tech', path: '/projects' })
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ at_risk: 'true', department: 'd-tech' }))
    const chip = await screen.findByRole('button', { name: 'Department: Technology' })
    await user.click(within(chip).getByTestId('CancelIcon'))
    await waitFor(() => expect(location()).toBe('/projects?at_risk=true'))
  })

  test('?new=1 opens the create form for admins only', async () => {
    server.use(
      http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
      http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
    )
    renderAsUser(<ProjectsPage />, { user: users.admin, route: '/projects?new=1', path: '/projects' })
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeInTheDocument()
  })

  test('?new=1 is ignored for people who cannot create projects', async () => {
    server.use(http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })))
    renderAsUser(<ProjectsPage />, { user: users.employee, route: '/projects?new=1', path: '/projects' })
    await screen.findByText(/no projects/i)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('?new=1 opens the request form for managers', async () => {
    server.use(http.get(`${API}/project-requests`, () => HttpResponse.json([])))
    renderAsUser(<RequestsPage />, { user: users.manager, route: '/requests?new=1', path: '/requests' })
    expect(await screen.findByRole('dialog', { name: 'Request a project' })).toBeInTheDocument()
  })
})
