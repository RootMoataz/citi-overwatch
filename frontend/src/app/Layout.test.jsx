import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import Puppy from '../features/puppy/Puppy.jsx'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import { API, HttpResponse, http, server } from '../test/server.js'
import { expectPhoneTarget } from '../test/cssRules.js'
import { setViewport } from '../test/setup.js'
import Layout from './Layout.jsx'

/** What Puppy and its panel read (nothing unread, nothing waiting). */
function serveForPuppy() {
  server.use(
    http.get(`${API}/notifications`, () => HttpResponse.json([])),
    http.get(`${API}/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/insights/smart`, () => HttpResponse.json([])),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/allocations`, () => HttpResponse.json([])),
    http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
  )
}

function renderLayout(user, onLogout = () => {}, { badges, extras } = {}) {
  return renderWithProviders(
    <Routes>
      <Route element={<Layout user={user} onLogout={onLogout} badges={badges} topBarExtras={extras} />}>
        <Route path="/" element={<><p>Home content</p><input aria-label="Notes" /></>} />
      </Route>
    </Routes>,
  )
}

describe('Layout', () => {
  test('phones: the logo link is a 44 px target', () => {
    setViewport(375)
    renderLayout(users.employee)
    const logo = screen.getByRole('link', { name: /acme scout/i })
    expectPhoneTarget(logo, 'min-height')
    expectPhoneTarget(logo, 'min-width')
  })

  test('desktop shows the navigation filtered by role', () => {
    renderLayout(users.employee)
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(screen.getByRole('link', { name: /my week/i })).toHaveAttribute('href', '/')
    expect(nav).not.toHaveTextContent('Dashboard')
    expect(nav).toHaveTextContent('My timesheet')
    expect(nav).not.toHaveTextContent('Timesheets')
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
    for (const item of ['Timesheets', 'Allocation', 'Project requests', 'People', 'Audit log']) {
      expect(nav).toHaveTextContent(item)
    }
  })

  test('admins get an Admin group, separate from the work items', () => {
    renderLayout(users.admin)
    const admin = screen.getByRole('list', { name: /^admin$/i })
    expect(within(admin).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['People', 'Departments', 'Skills', 'Project requests', 'Archive', 'Audit log'])
    const work = screen.getByRole('list', { name: /^work$/i })
    expect(within(work).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Control centre', 'Messages', 'Projects', 'Timesheets', 'Allocation'])
  })

  test('managers have no Admin group and keep Project requests and Archive with their work', () => {
    renderLayout(users.manager)
    expect(screen.queryByRole('list', { name: /^admin$/i })).not.toBeInTheDocument()
    const work = screen.getByRole('list', { name: /^work$/i })
    expect(within(work).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Dashboard', 'Messages', 'Projects', 'Timesheets', 'Allocation', 'Project requests', 'Archive'])
  })

  test('a manager or admin who tracks their own hours also gets My timesheet', () => {
    const { unmount } = renderLayout({ ...users.manager, tracks_own_hours: true })
    expect(within(screen.getByRole('list', { name: /^work$/i })).getAllByRole('link').map((a) => a.textContent))
      .toEqual(['Dashboard', 'Messages', 'Projects', 'My timesheet', 'Timesheets', 'Allocation', 'Project requests', 'Archive'])
    unmount()
    renderLayout({ ...users.admin, tracks_own_hours: true })
    expect(screen.getByRole('navigation', { name: /main/i })).toHaveTextContent('My timesheet')
  })

  test('executives get Timesheets (HR submissions, read-only) and no My timesheet', () => {
    renderLayout(users.executive)
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(nav).toHaveTextContent('Timesheets')
    expect(nav).not.toHaveTextContent('My timesheet')
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
    expect(await screen.findByRole('navigation', { name: /main/i })).toHaveTextContent('Timesheets')
  })

  test('user menu signs out', async () => {
    const onLogout = vi.fn()
    renderLayout(users.manager, onLogout)
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))
    expect(onLogout).toHaveBeenCalled()
  })

  test.each(['employee', 'manager', 'admin'])('every role (%s) can open the profile photo dialog from the account menu', async (role) => {
    renderLayout(users[role])
    const button = screen.getByRole('button', { name: 'Account menu' })
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

  test('the sidebar logo is a link home named "ACME Scout"', () => {
    renderLayout(users.manager)
    const logo = within(screen.getByTestId('sidebar')).getByRole('link', { name: 'ACME Scout' })
    expect(logo).toHaveAttribute('href', '/')
  })

  test('on a phone the top bar shows the glyph alone, as a link home named "ACME Scout"', () => {
    setViewport(390)
    renderLayout(users.manager)
    const logo = within(screen.getByRole('banner')).getByRole('link', { name: 'ACME Scout' })
    expect(logo).toHaveAttribute('href', '/')
    expect(logo).not.toHaveTextContent('Scout')
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
    renderLayout(users.manager, () => {}, { badges: { '/timesheets': 3 } })
    const approvals = screen.getByRole('link', { name: /timesheets/i })
    expect(within(approvals).getByText('3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    const collapsed = screen.getByRole('link', { name: /timesheets/i })
    expect(within(collapsed).queryByText('3')).not.toBeInTheDocument()
    expect(collapsed).toHaveAccessibleName('Timesheets (3 waiting)')
    expect(collapsed.querySelector('.MuiBadge-dot')).not.toBeNull()
  })

  test('phones keep the menu drawer and have no collapse control', () => {
    setViewport(390)
    renderLayout(users.manager)
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
  })

  test('the header has the search button that opens the command palette', () => {
    renderLayout(users.manager)
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('button', { name: /^search/i })).toHaveAttribute('aria-haspopup', 'dialog')
  })

})

const NAV_BY_ROLE = [
  ['employee', users.employee, { Work: ['My week', 'Messages', 'Projects', 'My timesheet', 'My history'] }],
  ['manager', users.manager,
    { Work: ['Dashboard', 'Messages', 'Projects', 'Timesheets', 'Allocation', 'Project requests', 'Archive'] }],
  ['manager who tracks their own hours', { ...users.manager, tracks_own_hours: true },
    { Work: ['Dashboard', 'Messages', 'Projects', 'My timesheet', 'Timesheets', 'Allocation', 'Project requests', 'Archive'] }],
  ['executive', users.executive,
    { Work: ['Dashboard', 'Messages', 'Projects', 'Timesheets', 'Allocation', 'Archive', 'Audit log'] }],
  ['admin', users.admin, {
    Work: ['Control centre', 'Messages', 'Projects', 'Timesheets', 'Allocation'],
    Admin: ['People', 'Departments', 'Skills', 'Project requests', 'Archive', 'Audit log'],
  }],
  ['admin who tracks their own hours', { ...users.admin, tracks_own_hours: true }, {
    Work: ['Control centre', 'Messages', 'Projects', 'My timesheet', 'Timesheets', 'Allocation'],
    Admin: ['People', 'Departments', 'Skills', 'Project requests', 'Archive', 'Audit log'],
  }],
]

describe('sidebar navigation per role', () => {
  test.each(NAV_BY_ROLE)('%s: group headings, items and order', (_name, user, groups) => {
    renderLayout(user)
    const nav = screen.getByRole('navigation', { name: /main/i })
    const lists = within(nav).getAllByRole('list')
    expect(lists.map((list) => list.getAttribute('aria-labelledby')).map((id) => document.getElementById(id).textContent))
      .toEqual(Object.keys(groups))
    Object.values(groups).forEach((items, index) => {
      expect(within(lists[index]).getAllByRole('link').map((a) => a.textContent)).toEqual(items)
    })
  })
})

describe('account menu and user chip', () => {
  const chipName = `${users.manager.first_name} ${users.manager.last_name}, account menu`

  async function expectFullMenu() {
    expect(await screen.findByRole('menuitem', { name: /my profile/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /profile photo/i })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['Light', 'Dark', 'SystemMatch this device'])
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  }

  test('the sidebar user chip is named for the person and opens the menu', async () => {
    renderLayout(users.manager)
    await userEvent.click(within(screen.getByTestId('sidebar')).getByRole('button', { name: chipName }))
    await expectFullMenu()
  })

  test('the header avatar opens the same menu', async () => {
    renderLayout(users.manager)
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Account menu' }))
    await expectFullMenu()
  })

  test('with the sidebar collapsed the chip is the avatar alone, still named, and still opens the menu', async () => {
    renderLayout(users.manager)
    await userEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    const chip = within(screen.getByTestId('sidebar')).getByRole('button', { name: chipName })
    expect(chip).not.toHaveTextContent('Morgan Manager')
    await userEvent.click(chip)
    await expectFullMenu()
  })

  test('Sign out from the chip signs out', async () => {
    const onLogout = vi.fn()
    renderLayout(users.manager, onLogout)
    await userEvent.click(screen.getByRole('button', { name: chipName }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))
    expect(onLogout).toHaveBeenCalled()
  })

  // `hidden`: while the menu is open the page behind it is hidden from the accessibility tree.
  test.each([
    ['the header avatar', () => within(screen.getByRole('banner', { hidden: true })).getByRole('button', { name: 'Account menu', hidden: true })],
    ['the sidebar chip', () => within(screen.getByTestId('sidebar')).getByRole('button', { name: chipName, hidden: true })],
  ])('%s says whether the menu is open, and the menu opens on My profile', async (_name, opener) => {
    const user = userEvent.setup()
    renderLayout(users.manager)
    expect(opener()).toHaveAttribute('aria-expanded', 'false')
    await user.click(opener())
    const menu = await screen.findByRole('menu')
    expect(opener()).toHaveAttribute('aria-expanded', 'true')
    expect(opener()).toHaveAttribute('aria-controls', menu.id)
    // Not the selected theme item: the first item, as a menu opened from a button should.
    await vi.waitFor(() => expect(screen.getByRole('menuitem', { name: /my profile/i })).toHaveFocus())
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(opener()).toHaveAttribute('aria-expanded', 'false')
  })

  test('only the opener that opened the menu is marked expanded', async () => {
    renderLayout(users.manager)
    await userEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Account menu' }))
    await screen.findByRole('menu')
    expect(within(screen.getByTestId('sidebar')).getByRole('button', { name: chipName, hidden: true }))
      .toHaveAttribute('aria-expanded', 'false')
  })

  test('the phone drawer shows the chip at the bottom and no Collapse', async () => {
    setViewport(390)
    renderLayout(users.manager)
    await userEvent.click(screen.getByRole('button', { name: /open navigation/i }))
    const nav = await screen.findByRole('navigation', { name: /main/i })
    const chip = screen.getByRole('button', { name: chipName })
    expect(nav.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull()
  })
})

describe('top bar order', () => {
  afterEach(() => { try { sessionStorage.clear() } catch { /* nothing stored */ } })

  test('Search, timer, Puppy, Notifications, then the account avatar', () => {
    const extras = <><button>Timer</button><button>Puppy</button><button>Notifications</button></>
    renderLayout(users.manager, () => {}, { extras })
    const names = within(screen.getByRole('banner')).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names).toEqual(['Search (Ctrl+K)', 'Timer', 'Puppy', 'Notifications', 'Account menu'])
  })

  test('for a demo user the pill sits between Notifications and the account avatar', () => {
    const user = { ...users.demoAdmin, session_expires_at: new Date(Date.now() + 269_000).toISOString() }
    sessionStorage.setItem(`acme-scout:demo-welcomed:${user.session_expires_at}`, '1')
    const extras = <><button>Timer</button><button>Puppy</button><button>Notifications</button></>
    renderLayout(user, () => {}, { extras })
    const names = within(screen.getByRole('banner')).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names).toEqual(['Search (Ctrl+K)', 'Timer', 'Puppy', 'Notifications',
      expect.stringMatching(/^Demo session · 4:\d{2}, signed out in 4 minutes \d+ seconds$/), 'Account menu'])
  })

  test('Search is named "Search (Ctrl+K)" and opens the palette', async () => {
    renderAsUser(<Layout user={users.manager} onLogout={() => {}} />, { user: users.manager })
    await userEvent.click(screen.getByRole('button', { name: 'Search (Ctrl+K)' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('under 375 px Puppy moves from the bar into the account menu, and opens from there', async () => {
    serveForPuppy()
    setViewport(320)
    renderAsUser(<Layout user={users.manager} onLogout={() => {}} topBarExtras={<Puppy />} />, { user: users.manager })
    const bar = screen.getByRole('banner')
    expect(within(bar).queryByRole('button', { name: 'Puppy assistant' })).toBeNull()
    await userEvent.click(within(bar).getByRole('button', { name: 'Account menu' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Puppy assistant' }))
    expect(await screen.findByRole('dialog', { name: 'Puppy assistant' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  test("under 375 px the avatar reports Puppy's docked panel as expanded while it is open", async () => {
    serveForPuppy()
    setViewport(320)
    renderAsUser(<Layout user={users.manager} onLogout={() => {}} topBarExtras={<Puppy />} />, { user: users.manager })
    const avatar = within(screen.getByRole('banner')).getByRole('button', { name: 'Account menu' })
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(avatar)
    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Puppy assistant' }))
    await screen.findByRole('dialog', { name: 'Puppy assistant' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Puppy assistant' })).not.toBeInTheDocument())
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
  })

  test('from 375 px Puppy stays in the bar and the account menu has no Puppy item', async () => {
    serveForPuppy()
    setViewport(375)
    renderAsUser(<Layout user={users.manager} onLogout={() => {}} topBarExtras={<Puppy />} />, { user: users.manager })
    const bar = screen.getByRole('banner')
    expect(within(bar).getByRole('button', { name: 'Puppy assistant' })).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: 'Account menu' }))
    expect(await screen.findByRole('menuitem', { name: 'My profile' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Puppy assistant' })).toBeNull()
  })

  test('below md Search is icon-only but keeps its name', () => {
    setViewport(700)
    renderLayout(users.manager)
    const search = screen.getByRole('button', { name: 'Search (Ctrl+K)' })
    expect(search).not.toHaveTextContent('Search…')
  })
})
