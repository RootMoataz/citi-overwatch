import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { SessionContext } from '../auth/sessionContext.js'
import { AppProviders } from '../app/providers.jsx'
import { makeQueryClient } from '../app/queryClient.js'

/** `entries` (optional) is the history to start with, ending on the current page; else just `route`. */
export function renderWithProviders(ui, { route = '/', entries, queryClient } = {}) {
  const client = queryClient ?? makeQueryClient({ test: true })
  const history = entries ?? [route]
  return render(
    <AppProviders queryClient={client}>
      <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>{ui}</MemoryRouter>
    </AppProviders>,
  )
}

export const users = {
  admin: { id: 'u-admin', username: 'admin.demo', first_name: 'Avery', last_name: 'Admin', role: 'admin' },
  manager: { id: 'u-mgr', username: 'manager.demo', first_name: 'Morgan', last_name: 'Manager', role: 'manager' },
  employee: { id: 'u-emp', username: 'employee.demo', first_name: 'Eli', last_name: 'Employee', role: 'employee' },
  executive: { id: 'u-exec', username: 'executive.demo', first_name: 'Moataz', last_name: 'Hikal', role: 'executive' },
  // The public demo admin (published password): an admin whose risky actions are disabled. Tests that need the
  // countdown give it a session_expires_at.
  demoAdmin: { id: 'u-demo-admin', username: 'demo.admin', first_name: 'Dana', last_name: 'Demo-Admin', role: 'admin',
    is_public_demo: true, session_expires_at: null },
}

/** Render a page as a signed-in user, with a probe that prints the current URL. */
export function renderAsUser(ui, { user, route = '/', entries, path = '*' } = {}) {
  const session = { user, status: 'ready', login: async () => user, logout: async () => {},
    changePassword: async () => user, setUser: () => {} }
  return renderWithProviders(
    <SessionContext.Provider value={session}>
      <Routes>
        <Route path={path} element={ui} />
        <Route path="/projects/:id" element={<ProjectProbe />} />
      </Routes>
      <LocationProbe />
    </SessionContext.Provider>,
    { route, entries },
  )
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function ProjectProbe() {
  const { id } = useParams()
  return <p>project page {id}</p>
}
