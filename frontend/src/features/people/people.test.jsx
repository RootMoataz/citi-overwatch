import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import RequireAuth from '../../auth/RequireAuth.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import AuditPage from '../audit/AuditPage.jsx'
import ProfilePage from '../profile/ProfilePage.jsx'
import CreateUserWizard from './CreateUserWizard.jsx'
import UserDetailPage from './UserDetailPage.jsx'
import { EMAILJS_URL } from '../../lib/emailRelay.js'

const managers = http.get(`${API}/users`, () => HttpResponse.json({ items: [
  { id: 'u-mgr', username: 'manager.demo', first_name: 'Morgan', last_name: 'Manager', role: 'manager', job_title: 'Lead' }], total: 1 }))

function availability(taken = ['alovelace']) {
  return http.get(`${API}/users/username-availability`, ({ request }) => {
    const username = new URL(request.url).searchParams.get('username') ?? ''
    const valid = /^[a-z0-9._]{3,20}$/.test(username)
    return HttpResponse.json({ username, valid, available: valid && !taken.includes(username),
      suggestions: ['ada.lovelace', 'lovelacea', 'ada_lovelace', 'adal', 'alovelace42'] })
  })
}

async function fillName(user, dialog) {
  await user.type(within(dialog).getByLabelText(/first name/i), 'Ada')
  await user.type(within(dialog).getByLabelText(/last name/i), 'Lovelace')
}

const renderWizard = () => renderAsUser(<CreateUserWizard onClose={() => {}} />, { user: users.admin, route: '/people-under-test' })

describe('CreateUserWizard', () => {
  test('wizard steps stay disabled until previous step valid', async () => {
    server.use(managers, availability())
    renderWizard()
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog', { name: /new account/i })
    const next = within(dialog).getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/first name/i), 'Ada')
    expect(next).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/last name/i), 'Lovelace')
    expect(next).toBeEnabled()
    await user.click(next)
    expect(within(dialog).getByRole('button', { name: /next/i })).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/email/i), 'not-an-email')
    expect(within(dialog).getByRole('button', { name: /next/i })).toBeDisabled()
    await user.clear(within(dialog).getByLabelText(/email/i))
    await user.type(within(dialog).getByLabelText(/email/i), 'ada@acme.example')
    await user.click(within(dialog).getByRole('combobox', { name: /role/i }))
    await user.click(await screen.findByRole('option', { name: 'Employee' }))
    expect(within(dialog).getByRole('button', { name: /next/i })).toBeDisabled()     // employee needs a manager
    await user.click(within(dialog).getByRole('combobox', { name: /reports to/i }))
    await user.click(await screen.findByRole('option', { name: /morgan manager/i }))
    expect(within(dialog).getByRole('button', { name: /next/i })).toBeEnabled()
  }, 15000) // Types a whole form step by step; under a full parallel run it sits close to the 5s default.

  test('username suggestions clickable and taken name shows ✗', async () => {
    server.use(managers, availability(['alovelace']))
    renderWizard()
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog', { name: /new account/i })
    await fillName(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await user.type(within(dialog).getByLabelText(/email/i), 'ada@acme.example')
    await user.click(within(dialog).getByRole('combobox', { name: /role/i }))
    await user.click(await screen.findByRole('option', { name: 'Manager' }))
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    const username = within(dialog).getByLabelText(/^username/i)
    await user.clear(username)
    await user.type(username, 'alovelace')
    expect(await within(dialog).findByLabelText('Taken')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /next/i })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'ada.lovelace' }))
    expect(username).toHaveValue('ada.lovelace')
    expect(await within(dialog).findByLabelText('Available')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /next/i })).toBeEnabled()
  })

  test('generate password satisfies checklist; show-once dialog when email_sent is false', async () => {
    let posted = null
    server.use(managers, availability([]), http.post(`${API}/users`, async ({ request }) => {
      posted = await request.json()
      return HttpResponse.json({ user: { id: 'u-new', username: posted.username, first_name: 'Ada', last_name: 'Lovelace' },
        email_sent: false, temp_password: posted.password }, { status: 201 })
    }))
    renderWizard()
    const user = userEvent.setup()
    const dialog = await screen.findByRole('dialog', { name: /new account/i })
    await fillName(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await user.type(within(dialog).getByLabelText(/email/i), 'ada@acme.example')
    await user.click(within(dialog).getByRole('combobox', { name: /role/i }))
    await user.click(await screen.findByRole('option', { name: 'Manager' }))
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await within(dialog).findByLabelText('Available')
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await user.click(within(dialog).getByRole('button', { name: /generate password/i }))
    const password = within(dialog).getByLabelText(/temporary password/i)
    expect(password.value).toHaveLength(12)
    for (const li of within(dialog).getByRole('list', { name: /password requirements/i }).querySelectorAll('li')) {
      expect(li).toHaveAttribute('data-met', 'true')
    }
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    expect(within(dialog).getByText('ada@acme.example')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(posted).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace', role: 'manager',
      email: 'ada@acme.example' }))
    const once = await screen.findByRole('dialog', { name: /share these sign-in details/i })
    expect(within(once).getByText(posted.username)).toBeInTheDocument()
    expect(within(once).getByText(posted.password)).toBeInTheDocument()
    expect(within(once).getAllByRole('button', { name: /copy/i })).toHaveLength(2)
  })
})

describe('CreateUserWizard email relay', () => {
  afterEach(() => vi.unstubAllEnvs())

  async function createAda(user) {
    const dialog = await screen.findByRole('dialog', { name: /new account/i })
    await fillName(user, dialog)
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await user.type(within(dialog).getByLabelText(/email/i), 'ada@acme.example')
    await user.click(within(dialog).getByRole('combobox', { name: /role/i }))
    await user.click(await screen.findByRole('option', { name: 'Manager' }))
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await within(dialog).findByLabelText('Available')
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await user.click(within(dialog).getByRole('button', { name: /generate password/i }))
    await user.click(within(dialog).getByRole('button', { name: /next/i }))
    await user.click(within(dialog).getByRole('button', { name: /create account/i }))
  }

  const created = http.post(`${API}/users`, async ({ request }) => {
    const posted = await request.json()
    return HttpResponse.json({ user: { id: 'u-new', username: posted.username, first_name: 'Ada', last_name: 'Lovelace',
      email: 'ada@acme.example' }, email_sent: false, temp_password: posted.password }, { status: 201 })
  })

  test('when the server cannot email, the browser relays the sign-in details instead of showing them', async () => {
    vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 's'); vi.stubEnv('VITE_EMAILJS_TEMPLATE_ID', 't'); vi.stubEnv('VITE_EMAILJS_PUBLIC_KEY', 'k')
    let relayed = null
    let closed = false
    server.use(managers, availability([]), created,
      http.post(EMAILJS_URL, async ({ request }) => { relayed = await request.json(); return new HttpResponse('OK') }))
    renderAsUser(<CreateUserWizard onClose={() => { closed = true }} />, { user: users.admin, route: '/people-under-test' })
    await createAda(userEvent.setup())
    await waitFor(() => expect(closed).toBe(true))
    expect(relayed.template_params).toMatchObject({ to_email: 'ada@acme.example', to_name: 'Ada Lovelace' })
    expect(screen.queryByRole('dialog', { name: /share these sign-in details/i })).not.toBeInTheDocument()
  })

  test('if the relay fails too, the details are shown once', async () => {
    vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 's'); vi.stubEnv('VITE_EMAILJS_TEMPLATE_ID', 't'); vi.stubEnv('VITE_EMAILJS_PUBLIC_KEY', 'k')
    server.use(managers, availability([]), created, http.post(EMAILJS_URL, () => new HttpResponse('bad', { status: 400 })))
    renderWizard()
    await createAda(userEvent.setup())
    expect(await screen.findByRole('dialog', { name: /share these sign-in details/i })).toBeInTheDocument()
  })
})

describe('ProfilePage', () => {
  test('profile cannot edit salary or role', async () => {
    let put = null
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ id: 'u-emp', username: 'employee.demo', first_name: 'Eli',
      last_name: 'Employee', email: 'eli@acme.example', role: 'employee', job_title: 'Engineer', salary: 104000 })),
    http.put(`${API}/me`, async ({ request }) => { put = await request.json(); return HttpResponse.json({ ...put }) }))
    renderAsUser(<ProfilePage />, { user: users.employee, route: '/profile', path: '/profile' })
    const user = userEvent.setup()
    expect(await screen.findByText('$104,000')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /salary/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /role/i })).not.toBeInTheDocument()
    const first = screen.getByLabelText(/first name/i)
    await user.clear(first)
    await user.type(first, 'Elias')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(put).toEqual({ first_name: 'Elias', last_name: 'Employee', email: 'eli@acme.example' }))
  })

  test('the profile page opens the photo dialog', async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ id: 'u-emp', username: 'employee.demo', first_name: 'Eli',
      last_name: 'Employee', email: 'eli@acme.example', role: 'employee', job_title: 'Engineer', salary: 104000 })))
    renderAsUser(<ProfilePage />, { user: users.employee, route: '/profile', path: '/profile' })
    await userEvent.click(await screen.findByRole('button', { name: /change photo/i }))
    expect(await screen.findByRole('dialog', { name: /profile photo/i })).toBeInTheDocument()
  })
})

describe('AuditPage', () => {
  test('audit page not reachable by manager', () => {
    renderAsUser(<RequireAuth roles={['admin']}><AuditPage /></RequireAuth>, { user: users.manager, route: '/audit', path: '/audit' })
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
  })

  test('admin sees entries and can expand the before/after', async () => {
    server.use(http.get(`${API}/audit-log`, () => HttpResponse.json({ total: 1, items: [{ id: 'a1', action: 'update',
      entity_type: 'project', entity_id: 'p1', request_id: 'r-1', created_at: '2026-10-13T12:00:00Z',
      actor: { id: 'u-admin', name: 'Avery Admin' }, changes: { before: { budget: 1000 }, after: { budget: 2000 } } }] })))
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    expect(await screen.findByText('Avery Admin')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /show changes/i }))
    await userEvent.click(await screen.findByRole('button', { name: /show raw json/i }))
    expect(await screen.findByText(/"budget": 2000/)).toBeInTheDocument()
  })

  test('changes read as one line per changed field, with the raw JSON behind a toggle', async () => {
    server.use(http.get(`${API}/audit-log`, () => HttpResponse.json({ total: 1, items: [{ id: 'a1', action: 'update',
      entity_type: 'project', entity_id: 'p1', request_id: 'r-1', created_at: '2026-10-13T12:00:00Z',
      actor: { id: 'u-admin', name: 'Avery Admin' },
      changes: { before: { budget: 1000, status: 'active', end_date: null }, after: { budget: 2000, status: 'active', end_date: '2026-12-31' } } }] })))
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /show changes/i }))
    const list = await screen.findByRole('list', { name: /changed fields/i })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['budget: 1000 → 2000', 'end date: — → 2026-12-31'])
    expect(screen.getByText(/request id: r-1/i)).toBeInTheDocument()
    expect(screen.queryByText(/"budget": 2000/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /show raw json/i }))
    expect(await screen.findByText(/"budget": 2000/)).toBeInTheDocument()
  })

  test('Who and Action filters are sent to the server', async () => {
    const seen = []
    server.use(
      http.get(`${API}/audit-log`, ({ request }) => {
        seen.push(Object.fromEntries(new URL(request.url).searchParams))
        return HttpResponse.json({ total: 0, items: [] })
      }),
      http.get(`${API}/users`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('archived') === 'true'
        ? { items: [{ id: 'u-old', first_name: 'Olive', last_name: 'Old', username: 'oold', role: 'employee', is_archived: true }], total: 1 }
        : { items: [{ id: 'u-blake', first_name: 'Blake', last_name: 'Admin', username: 'badmin', role: 'admin' }], total: 1 })),
    )
    renderAsUser(<AuditPage />, { user: users.admin, route: '/audit', path: '/audit' })
    const user = userEvent.setup()
    await user.type(await screen.findByRole('combobox', { name: /who/i }), 'bla')
    await user.click(await screen.findByRole('option', { name: /blake admin/i }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ actor: 'u-blake' }))
    await user.click(screen.getByRole('combobox', { name: /action/i }))
    await user.click(await screen.findByRole('option', { name: /^archive$/i }))
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ actor: 'u-blake', action: 'archive' }))
    await user.clear(screen.getByRole('combobox', { name: /who/i }))
    await user.type(screen.getByRole('combobox', { name: /who/i }), 'oli')
    expect(await screen.findByRole('option', { name: /olive old \(archived\)/i })).toBeInTheDocument()
  })
})

describe('UserDetailPage', () => {
  test('admin puts a person in a department', async () => {
    let put = null
    const ada = { id: 'u-ada', username: 'ada', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@acme.example',
      role: 'employee', job_title: 'Analyst', salary: 90000, manager_id: 'u-mgr', department_id: null, is_archived: false }
    server.use(managers,
      http.get(`${API}/users/u-ada`, () => HttpResponse.json(ada)),
      http.get(`${API}/departments`, () => HttpResponse.json({ items: [{ id: 'd1', name: 'Technology', is_archived: false }] })),
      http.put(`${API}/users/u-ada`, async ({ request }) => { put = await request.json(); return HttpResponse.json({ ...ada, ...put }) }))
    renderAsUser(<UserDetailPage />, { user: users.admin, route: '/people/u-ada', path: '/people/:id' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('combobox', { name: /department/i }))
    await user.click(await screen.findByRole('option', { name: 'Technology' }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(put).toEqual({ department_id: 'd1' }))
  })
})
