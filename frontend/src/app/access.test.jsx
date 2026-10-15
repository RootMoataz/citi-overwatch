import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import RequireAuth from '../auth/RequireAuth.jsx'
import { SessionContext } from '../auth/sessionContext.js'
import PersonProfilePage from '../features/people/PersonProfilePage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import { can } from '../lib/permissions.js'
import { API, HttpResponse, http, server } from '../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import { NO_ACCESS, NOT_FOUND, ROUTE_CHECKS, ROUTE_ROLES, mayOpenRoute } from './access.js'
import { NAV } from './nav.jsx'
import NotFound from './NotFound.jsx'

function Where() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

/** The real guard and role table, with a stand-in page per route. */
function renderGuarded(user, route) {
  const session = { user, status: 'ready', login: async () => user, logout: async () => {},
    changePassword: async () => user, setUser: () => {} }
  return renderWithProviders(
    <SessionContext.Provider value={session}>
      <Routes>
        <Route path="/" element={<p>Home page</p>} />
        {Object.entries(ROUTE_ROLES).map(([path, roles]) => (
          <Route key={path} path={`/${path}`}
            element={<RequireAuth roles={roles} allow={ROUTE_CHECKS[path]}><p>Guarded page</p></RequireAuth>} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Where />
    </SessionContext.Provider>,
    { route },
  )
}

// Managers and admins have no personal timesheet unless an admin turned on "Tracks own hours" for them.
const handsOn = (user) => ({ ...user, tracks_own_hours: true })
const roles = { ...users, handsOnManager: handsOn(users.manager), handsOnAdmin: handsOn(users.admin) }

const denied = {
  employee: ['/timesheets', '/allocation', '/people', '/people/u-ada', '/archive', '/audit', '/departments', '/requests'],
  manager: ['/people', '/people/u-ada', '/audit', '/departments', '/timesheet'],
  admin: ['/timesheet'],
  executive: ['/requests', '/people', '/people/u-ada', '/departments', '/timesheet'],
}

describe('route guard', () => {
  test.each(Object.entries(denied).flatMap(([role, paths]) => paths.map((path) => [role, path])))(
    '%s opening %s lands on their home with a message', async (role, path) => {
      renderGuarded(users[role], path)
      expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument()
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
      expect(screen.getByText('Home page')).toBeInTheDocument()
      expect(screen.queryByText('Guarded page')).not.toBeInTheDocument()
    })

  test.each(['/timesheets', '/allocation', '/archive', '/requests'])('managers open %s', (path) => {
    renderGuarded(users.manager, path)
    expect(screen.getByText('Guarded page')).toBeInTheDocument()
  })

  test.each(['/allocation', '/archive', '/audit', '/timesheets'])('executives open %s', (path) => {
    renderGuarded(users.executive, path)
    expect(screen.getByText('Guarded page')).toBeInTheDocument()
  })

  test.each(['handsOnAdmin', 'handsOnManager', 'employee'])('%s keeps a timesheet', (role) => {
    renderGuarded(roles[role], '/timesheet')
    expect(screen.getByText('Guarded page')).toBeInTheDocument()
  })

  test.each(Object.keys(ROUTE_ROLES))('admins (who track their hours) open /%s', (path) => {
    renderGuarded(roles.handsOnAdmin, `/${path.replace(':id', 'u-ada')}`)
    expect(screen.getByText('Guarded page')).toBeInTheDocument()
  })

  test("the role table agrees with the navigation: nobody is shown a link they can't open", () => {
    for (const [who, user] of Object.entries(roles)) {
      for (const item of NAV.filter((i) => i.action && typeof i.to === 'string')) {
        expect([item.to, who, mayOpenRoute(user, item.to.slice(1))]).toEqual([item.to, who, can(user, item.action)])
      }
    }
  })

  test('the old /approvals address is gone from the role table (App.jsx redirects it to /timesheets)', () => {
    expect(ROUTE_ROLES).not.toHaveProperty('approvals')
  })

  test("an address that doesn't exist goes home and says so", async () => {
    renderGuarded(users.employee, '/no-such-page')
    expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })
})

const apiError = (status, code) => HttpResponse.json({ error: { code, message: code } }, { status })

describe("a page whose main data is refused or gone", () => {
  test('a project the viewer may not open (403) goes home with the no-access message', async () => {
    server.use(http.get(`${API}/projects/p1`, () => apiError(403, 'FORBIDDEN')))
    renderAsUser(<ProjectDetailPage />, { user: users.employee, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  test("a deleted project (404) goes home saying the page doesn't exist", async () => {
    server.use(http.get(`${API}/projects/gone`, () => apiError(404, 'NOT_FOUND')))
    renderAsUser(<ProjectDetailPage />, { user: users.manager, route: '/projects/gone', path: '/projects/:id' })
    expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  test("a profile the server hides (404 means not allowed there) goes home with the no-access message", async () => {
    server.use(http.get(`${API}/users/u-ada/profile`, () => apiError(404, 'NOT_FOUND')))
    renderAsUser(<PersonProfilePage />, { user: users.employee, route: '/people/u-ada/profile', path: '/people/:id/profile' })
    expect(await screen.findByText(NO_ACCESS)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  test('other failures stay on the page with a retry', async () => {
    server.use(http.get(`${API}/projects/p1`, () => apiError(500, 'INTERNAL_ERROR')))
    renderAsUser(<ProjectDetailPage />, { user: users.admin, route: '/projects/p1', path: '/projects/:id' })
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/p1')
  })
})
