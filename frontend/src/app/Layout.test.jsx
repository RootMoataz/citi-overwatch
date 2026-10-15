import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { renderWithProviders, users } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import Layout from './Layout.jsx'

function renderLayout(user, onLogout = () => {}) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout user={user} onLogout={onLogout} />}>
        <Route path="/" element={<p>Home content</p>} />
      </Route>
    </Routes>,
  )
}

describe('Layout', () => {
  test('desktop shows the navigation filtered by role', () => {
    renderLayout(users.employee)
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(screen.getByRole('link', { name: /my week/i })).toHaveAttribute('href', '/')
    expect(nav).not.toHaveTextContent('Dashboard')
    expect(nav).toHaveTextContent('My timesheet')
    expect(nav).not.toHaveTextContent('Approvals')
    expect(nav).not.toHaveTextContent('People')
    expect(screen.getByText('Home content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open navigation/i })).not.toBeInTheDocument()
  })

  test('employees get a My history link to their own profile', () => {
    const { unmount } = renderLayout(users.employee)
    expect(screen.getByRole('link', { name: /my history/i })).toHaveAttribute('href', `/people/${users.employee.id}/profile`)
    unmount()
    renderLayout(users.manager)
    expect(screen.getByRole('navigation', { name: /main/i })).not.toHaveTextContent('My history')
  })

  test('admins see every section', () => {
    renderLayout(users.admin)
    const nav = screen.getByRole('navigation', { name: /main/i })
    for (const item of ['Approvals', 'Allocation', 'Project requests', 'People', 'Audit log']) {
      expect(nav).toHaveTextContent(item)
    }
  })

  test('admins get an Admin group, separate from the work items', () => {
    renderLayout(users.admin)
    const admin = screen.getByRole('list', { name: /^admin$/i })
    expect(within(admin).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['People', 'Departments', 'Project requests', 'Archive', 'Audit log'])
    const work = screen.getByRole('list', { name: /^work$/i })
    expect(within(work).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Control centre', 'Projects', 'My timesheet', 'Approvals', 'Allocation'])
  })

  test('managers have no Admin group and keep Project requests and Archive with their work', () => {
    renderLayout(users.manager)
    expect(screen.queryByRole('list', { name: /^admin$/i })).not.toBeInTheDocument()
    const work = screen.getByRole('list', { name: /^work$/i })
    expect(within(work).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Dashboard', 'Projects', 'My timesheet', 'Approvals', 'Allocation', 'Project requests', 'Archive'])
  })

  test('the current page is marked in the navigation', () => {
    renderLayout(users.manager)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current')
  })

  test('Layout shows drawer button on mobile width', async () => {
    setViewport(390)
    renderLayout(users.manager)
    expect(screen.queryByRole('navigation', { name: /main/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /open navigation/i }))
    expect(await screen.findByRole('navigation', { name: /main/i })).toHaveTextContent('Approvals')
  })

  test('user menu signs out', async () => {
    const onLogout = vi.fn()
    renderLayout(users.manager, onLogout)
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))
    expect(onLogout).toHaveBeenCalled()
  })
})
