import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { renderWithProviders, users } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import Layout from './Layout.jsx'

function renderLayout(user, onLogout = () => {}, { badges } = {}) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout user={user} onLogout={onLogout} badges={badges} />}>
        <Route path="/" element={<><p>Home content</p><input aria-label="Notes" /></>} />
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

  test.each(['employee', 'manager', 'admin'])('every role (%s) can open the profile photo dialog from the account menu', async (role) => {
    renderLayout(users[role])
    const button = screen.getByRole('button', { name: /account menu/i })
    const initials = `${users[role].first_name[0]}${users[role].last_name[0]}`
    expect(button).toHaveTextContent(initials)
    await userEvent.click(button)
    await userEvent.click(await screen.findByRole('menuitem', { name: /profile photo/i }))
    const dialog = await screen.findByRole('dialog', { name: /profile photo/i })
    expect(within(dialog).getByRole('button', { name: /choose a photo/i })).toBeInTheDocument()
  })

  test('the sidebar and the phone header carry the Scout brand, not the old name', () => {
    renderLayout(users.manager)
    expect(screen.getByRole('img', { name: /acme scout/i })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/overwatch/i)
  })
})

describe('collapsible sidebar', () => {
  test('collapses to icons, keeps every link reachable by name, and expands again', async () => {
    const user = userEvent.setup()
    renderLayout(users.manager)
    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(sidebar).toHaveAttribute('data-collapsed', 'true')
    // Labels are hidden visually but stay the links' accessible names.
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
    await user.click(screen.getByRole('button', { name: /expand sidebar/i }))
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
  })

  test('remembers the choice for the next visit', async () => {
    const { unmount } = renderLayout(users.manager)
    await userEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    unmount()
    renderLayout(users.manager)
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument()
  })

  test('still works when storage is blocked', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      renderLayout(users.manager)
      await userEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  test('the [ key toggles it, except while typing', async () => {
    const user = userEvent.setup()
    renderLayout(users.manager)
    const sidebar = screen.getByTestId('sidebar')
    await user.keyboard('[[')
    expect(sidebar).toHaveAttribute('data-collapsed', 'true')
    await user.click(screen.getByRole('textbox', { name: 'Notes' }))
    await user.keyboard('[[')
    expect(sidebar).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('[')
    await user.click(screen.getByText('Home content'))
    await user.keyboard('[[')
    expect(sidebar).toHaveAttribute('data-collapsed', 'false')
  })

  test('waiting approvals show as a count when expanded and as a labelled dot when collapsed', async () => {
    renderLayout(users.manager, () => {}, { badges: { '/approvals': 3 } })
    const approvals = screen.getByRole('link', { name: /approvals/i })
    expect(within(approvals).getByText('3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    const collapsed = screen.getByRole('link', { name: /approvals/i })
    expect(within(collapsed).queryByText('3')).not.toBeInTheDocument()
    expect(collapsed).toHaveAccessibleName('Approvals (3 waiting)')
    expect(collapsed.querySelector('.MuiBadge-dot')).not.toBeNull()
  })

  test('phones keep the menu drawer and have no collapse control', () => {
    setViewport(390)
    renderLayout(users.manager)
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
  })
})
