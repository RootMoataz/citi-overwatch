import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AppProviders } from '../../app/providers.jsx'
import { makeQueryClient } from '../../app/queryClient.js'
import { SessionContext } from '../../auth/sessionContext.js'
import { EMAILJS_URL } from '../../lib/emailRelay.js'
import { users } from '../../test/render.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { timing } from './createUsers.js'
import Puppy from './Puppy.jsx'

// Each test types through a whole conversation; under a full parallel run that sits past the 5s default.
const SLOW = { timeout: 30000 }

const MANAGERS = [{ id: 'u-mgr', first_name: 'Morgan', last_name: 'Manager', role: 'manager' }]
const ADMINS = [{ id: 'u-admin', first_name: 'Avery', last_name: 'Admin', role: 'admin' },
  { id: 'u-demo', first_name: 'Dana', last_name: 'Demo-Admin', role: 'admin', is_public_demo: true }]
const DEPARTMENTS = [{ id: 'd1', name: 'Technology' }, { id: 'd2', name: 'Operations' }]

let posted
let relayed
let takenUsernames
let usedEmails
let failFirst

function Where() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}</output>
}

function renderPuppy(user = users.admin) {
  const session = { user, status: 'ready', login: async () => user, logout: async () => {}, changePassword: async () => user,
    setUser: () => {} }
  render(
    <AppProviders queryClient={makeQueryClient({ test: true })}>
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <Puppy />
          <Where />
        </SessionContext.Provider>
      </MemoryRouter>
    </AppProviders>,
  )
}

const relayOn = () => {
  vi.stubEnv('VITE_EMAILJS_SERVICE_ID', 's'); vi.stubEnv('VITE_EMAILJS_TEMPLATE_ID', 't'); vi.stubEnv('VITE_EMAILJS_PUBLIC_KEY', 'k')
}

beforeEach(() => {
  timing.paceMs = 0
  posted = []
  relayed = []
  takenUsernames = ['john.doe']
  usedEmails = []
  failFirst = new Set()
  window.localStorage.clear()
  server.use(
    http.get(`${API}/notifications`, () => HttpResponse.json([])),
    http.get(`${API}/approvals`, () => HttpResponse.json([])),
    http.get(`${API}/insights/smart`, () => HttpResponse.json([])),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/allocations`, () => HttpResponse.json([])),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: DEPARTMENTS })),
    http.get(`${API}/users/username-availability`, ({ request }) => {
      const url = new URL(request.url)
      const username = url.searchParams.get('username') ?? ''
      const valid = /^[a-z0-9._]{3,20}$/.test(username)
      return HttpResponse.json({ username, valid, available: valid && !takenUsernames.includes(username), suggestions: ['jdoe'] })
    }),
    http.get(`${API}/users`, ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('role') === 'manager') return HttpResponse.json({ items: MANAGERS, total: 1 })
      if (url.searchParams.get('role') === 'admin') return HttpResponse.json({ items: ADMINS, total: 2 })
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const items = q ? usedEmails.filter((e) => e.toLowerCase() === q).map((email) => ({ id: 'u-old', email })) : []
      return HttpResponse.json({ items, total: items.length })
    }),
    http.post(`${API}/users`, async ({ request }) => {
      const body = await request.json()
      posted.push(body)
      if (failFirst.has(body.username)) {
        failFirst.delete(body.username)
        return HttpResponse.json({ error: { code: 'CONFLICT', message: 'That email is already taken', details: { email: 'taken' } } },
          { status: 409 })
      }
      return HttpResponse.json({ user: { id: `id-${body.username}`, username: body.username, first_name: body.first_name,
        last_name: body.last_name, email: body.email, role: body.role }, email_sent: false, temp_password: body.password },
      { status: 201 })
    }),
    http.post(EMAILJS_URL, async ({ request }) => { relayed.push((await request.json()).template_params); return new HttpResponse('OK') }),
  )
})
afterEach(() => vi.unstubAllEnvs())

async function openChat() {
  const user = userEvent.setup()
  renderPuppy()
  await user.click(screen.getByRole('button', { name: 'Puppy assistant' }))
  const panel = await screen.findByRole('dialog', { name: /puppy/i })
  await user.click(within(panel).getByRole('tab', { name: 'Do it' }))
  await user.click(await within(panel).findByRole('button', { name: 'Create user accounts' }))
  await within(panel).findByTestId('create-users-chat')
  return { user, panel }
}

/** Answer the current question in the text box (new lines allowed), then send. */
async function say(user, question, text) {
  const box = await screen.findByRole('textbox', { name: question })
  await waitFor(() => expect(box).not.toBeDisabled())
  await user.click(box)
  await user.paste(text)
  await user.click(screen.getByRole('button', { name: 'Send answer' }))
}
const chip = (name) => screen.findByRole('button', { name })

/** Names and emails for two people, stopping at the first role question. */
async function twoPeople(user) {
  await say(user, /names of the people/, 'Ada Lovelace, Alan Turing')
  await say(user, /email addresses/, 'ada@example.com, alan@example.com')
  await screen.findByRole('textbox', { name: /What role should Ada Lovelace have/ })
}

async function answerTwoAsManagers(user) {
  await twoPeople(user)
  await user.click(await chip('Manager'))
  await user.click(await chip('Skip'))
  await user.click(await chip('Use the same for everyone left'))
  await screen.findByRole('table', { name: 'Accounts to create' })
}

describe('who gets the conversation', SLOW, () => {
  test('a real admin finds it under Do it; the conversation starts with the names question, focused and labelled', async () => {
    await openChat()
    const log = screen.getByRole('log', { name: 'Conversation with Puppy' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    const box = screen.getByRole('textbox', { name: 'What are the names of the people to add? You can paste several, separated by commas or new lines.' })
    await waitFor(() => expect(box).toHaveFocus())
  })

  test('the public demo admin is told it is disabled, from Do it and from Ask, and nothing opens', async () => {
    const user = userEvent.setup()
    renderPuppy(users.demoAdmin)
    await user.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    await user.click(within(panel).getByRole('tab', { name: 'Do it' }))
    await user.click(await within(panel).findByRole('button', { name: 'Create user accounts' }))
    expect(within(panel).getByText('Creating accounts is disabled in the public demo.')).toBeInTheDocument()
    expect(within(panel).queryByTestId('create-users-chat')).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('tab', { name: 'Ask' }))
    await user.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), 'create users{Enter}')
    expect(await within(panel).findByText('Creating accounts is disabled in the public demo.')).toBeInTheDocument()
    expect(within(panel).queryByTestId('create-users-chat')).not.toBeInTheDocument()
    expect(posted).toEqual([])
  })

  test.each(['manager', 'employee', 'executive'])('a %s has no such action and Ask never opens it', async (role) => {
    const user = userEvent.setup()
    renderPuppy(users[role])
    await user.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    await user.click(within(panel).getByRole('tab', { name: 'Do it' }))
    await within(panel).findByTestId('puppy-actions')
    expect(within(panel).queryByRole('button', { name: 'Create user accounts' })).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('tab', { name: 'Ask' }))
    await user.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), 'create users{Enter}')
    await waitFor(() => expect(within(panel).queryByText(/sniffing/)).not.toBeInTheDocument())
    expect(within(panel).queryByTestId('create-users-chat')).not.toBeInTheDocument()
  })

  test.each(['create users', 'add users', 'new accounts', 'onboard people', 'create accounts for the instructors'])(
    'an admin asking "%s" starts the conversation', async (phrase) => {
      const user = userEvent.setup()
      renderPuppy()
      await user.click(screen.getByRole('button', { name: 'Puppy assistant' }))
      const panel = await screen.findByRole('dialog', { name: /puppy/i })
      await user.click(within(panel).getByRole('tab', { name: 'Ask' }))
      await user.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), `${phrase}{Enter}`)
      expect(await within(panel).findByTestId('create-users-chat')).toBeInTheDocument()
    })
})

describe('the conversation', SLOW, () => {
  test('the whole YES path: names, a missing last name, usernames, emails, each person, summary, create and email', async () => {
    relayOn()
    const { user } = await openChat()
    await say(user, /names of the people/, 'John Doe, Jane_Roe\nada.lovelace; Cher')
    await say(user, "What's Cher's last name?", 'Smith')
    // Usernames: john.doe is taken on the server, so john.doe2; typed usernames are kept.
    expect(await screen.findByRole('button', { name: /John Doe: username john\.doe2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Jane Roe: username jane_roe/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada Lovelace: username ada\.lovelace/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cher Smith: username cher\.smith/ })).toBeInTheDocument()

    // Three emails for four people: Puppy says so and shows the pairing.
    await say(user, /email addresses/, 'john@example.com, jane@example.com, ada@example.com')
    expect(await screen.findByText("I got 3 emails for 4 people — who's missing?")).toBeInTheDocument()
    expect(screen.getAllByText('(missing)').length).toBeGreaterThan(0)
    const box = screen.getByRole('textbox', { name: /email addresses/ })
    await user.clear(box)
    await say(user, /email addresses/, 'john@example.com\njane@example.com\nada@example.com\ncher@example.com')

    // Person 1: Employee → Morgan → Technology.
    expect(await screen.findByText('Person 1 of 4 · John Doe · john@example.com')).toBeInTheDocument()
    await user.click(await chip('Employee'))
    await screen.findByRole('textbox', { name: /Who will John Doe report to\?/ })
    expect(screen.queryByRole('button', { name: 'Dana Demo-Admin' })).toBeNull() // the shared demo login manages nobody
    await user.click(await chip('Morgan Manager'))
    await screen.findByRole('textbox', { name: /Department for John Doe\?/ })
    await user.click(await chip('Technology'))
    // Person 2, typed answers and "Same as previous".
    expect(await screen.findByText('Person 2 of 4 · Jane Roe · jane@example.com')).toBeInTheDocument()
    await say(user, /What role should Jane Roe have/, 'emp')
    await user.click(await chip('Same as previous'))
    await screen.findByRole('textbox', { name: /Department for Jane Roe\?/ })
    await user.click(await chip('Same as previous'))
    // Person 3: the same for everyone left.
    await screen.findByRole('textbox', { name: /What role should Ada Lovelace have/ })
    await user.click(await chip('Use the same for everyone left'))

    const table = await screen.findByRole('table', { name: 'Accounts to create' })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(within(table).getAllByText('Reports to Morgan Manager · Technology')).toHaveLength(4)
    const question = screen.getByText(/^I'll create these 4 accounts with randomly generated temporary passwords/)
    await waitFor(() => expect(question.closest('[tabindex="-1"]')).toHaveFocus())
    expect(posted).toEqual([]) // nothing yet

    await user.click(screen.getByRole('button', { name: 'Yes, create and email' }))
    expect(await screen.findByText("Done! 4 accounts created, 4 emails sent. They'll be asked to choose a password when they first sign in."))
      .toBeInTheDocument()
    expect(posted.map((b) => b.username)).toEqual(['john.doe2', 'jane_roe', 'ada.lovelace', 'cher.smith'])
    expect(posted[0]).toMatchObject({ first_name: 'John', last_name: 'Doe', email: 'john@example.com', role: 'employee',
      manager_id: 'u-mgr', department_id: 'd1' })
    for (const body of posted) expect(body.password).toMatch(/^(?=.*\d)(?=.*[!@#$%^&*?\-_+=]).{12,}$/)
    expect(relayed.map((r) => [r.to_email, r.username, r.temp_password]))
      .toEqual(posted.map((b) => [b.email, b.username, b.password]))
    expect(screen.getByTestId('status-cher.smith')).toHaveTextContent('Created ✓ · Emailed ✓')
    // The passwords are never on screen (nor in a toast).
    for (const body of posted) expect(document.body.textContent).not.toContain(body.password)

    await user.click(screen.getByRole('button', { name: "Open John Doe's profile" }))
    expect(screen.getByTestId('location')).toHaveTextContent('/people/id-john.doe2')
  })

  test('names: too many, an email instead of a name, symbols', async () => {
    const { user } = await openChat()
    await say(user, /names of the people/, Array.from({ length: 26 }, (_, i) => `Person ${String.fromCharCode(65 + (i % 26))}x`).join(', '))
    expect(await screen.findByText(/That's 26 people — I can add up to 25 at a time/)).toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: /names of the people/ }))
    await say(user, /names of the people/, 'jane@example.com')
    expect(await screen.findByText(/looks like an email address/)).toBeInTheDocument()
  })

  test('emails: invalid, duplicated and already used by an account', async () => {
    usedEmails = ['alan@example.com']
    const { user } = await openChat()
    await say(user, /names of the people/, 'Ada Lovelace, Alan Turing')
    const box = await screen.findByRole('textbox', { name: /email addresses/ })
    await say(user, /email addresses/, 'ada@example, alan@example.com')
    expect(await screen.findByText("These don't look like email addresses: ada@example. Please fix them.")).toBeInTheDocument()
    await user.clear(box)
    await say(user, /email addresses/, 'ada@example.com, ADA@example.com')
    expect(await screen.findByText('ADA@example.com appears more than once — each person needs their own email.')).toBeInTheDocument()
    await user.clear(box)
    await say(user, /email addresses/, 'ada@example.com, alan@example.com')
    expect(await screen.findByText('alan@example.com is already used by another Scout account. Please use a different address.'))
      .toBeInTheDocument()
  })

  test('a username chip can be changed; taken names are refused', async () => {
    takenUsernames = ['john.doe', 'johnny']
    const { user } = await openChat()
    await say(user, /names of the people/, 'John Doe')
    await user.click(await screen.findByRole('button', { name: /John Doe: username john\.doe2/ }))
    const field = await screen.findByRole('textbox', { name: 'Username for John Doe' })
    await user.clear(field)
    await user.type(field, 'johnny')
    await user.click(screen.getByRole('button', { name: 'Save username' }))
    expect(await screen.findByText('Already taken — try another')).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, 'jd.boss')
    await user.click(screen.getByRole('button', { name: 'Save username' }))
    expect(await screen.findByRole('button', { name: /John Doe: username jd\.boss/ })).toBeInTheDocument()
  })

  test('Back steps through earlier answers, across people, and puts the earlier answer back in the box', async () => {
    const { user } = await openChat()
    await twoPeople(user)
    // The first person gets the four roles, in this order (later people also get the shortcut).
    expect(within(screen.getByLabelText('Quick replies')).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Employee', 'Manager', 'Executive', 'Admin'])
    await user.click(await chip('Employee'))
    await user.click(await chip('Morgan Manager'))
    await user.click(await chip('Operations'))
    await screen.findByRole('textbox', { name: /What role should Alan Turing have/ })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('textbox', { name: /Department for Ada Lovelace\?/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('textbox', { name: /Who will Ada Lovelace report to\?/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    const emails = await screen.findByRole('textbox', { name: /email addresses/ })
    expect(emails).toHaveValue('ada@example.com, alan@example.com')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('textbox', { name: /names of the people/ })).toHaveValue('Ada Lovelace, Alan Turing')
  })

  test('the summary rows can be edited and removed', async () => {
    const { user } = await openChat()
    await answerTwoAsManagers(user)
    await user.click(screen.getByRole('button', { name: 'Edit Alan Turing' }))
    const form = screen.getByRole('form', { name: 'Edit Alan Turing' })
    await user.click(within(form).getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Employee' }))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByText('Employees need a reporting manager.')).toBeInTheDocument()
    await user.click(within(form).getByRole('combobox', { name: 'Reports to' }))
    await user.click(await screen.findByRole('option', { name: 'Avery Admin' }))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Alan Turing' })).not.toBeInTheDocument())
    expect(screen.getByText('Reports to Avery Admin')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Ada Lovelace' }))
    expect(screen.getByText(/^I'll create this account with a randomly generated temporary password/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, create and email' }))
    await screen.findByText(/1 account created/)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ username: 'alan.turing', role: 'employee', manager_id: 'u-admin' })
  })

  test('a failure is reported per row with the server message; Retry failed creates only that one', async () => {
    relayOn()
    failFirst = new Set(['alan.turing'])
    const { user } = await openChat()
    await answerTwoAsManagers(user)
    await user.click(screen.getByRole('button', { name: 'Yes, create and email' }))
    expect(await screen.findByTestId('status-alan.turing')).toHaveTextContent('Failed: That email is already taken')
    expect(screen.getByText(/1 of 2 accounts created, 1 email sent\. 1 couldn't be created/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry failed' }))
    expect(await screen.findByText(/^Done! 2 accounts created, 2 emails sent/)).toBeInTheDocument()
    expect(posted.map((b) => b.username)).toEqual(['ada.lovelace', 'alan.turing', 'alan.turing'])
    expect(relayed).toHaveLength(2)
  })

  test('when email is not set up, Puppy offers to show each password once; it needs "I\'ve saved it" and then forgets it', async () => {
    const { user } = await openChat() // no EmailJS settings
    await answerTwoAsManagers(user)
    expect(screen.getByText(/the email relay isn't set up in this browser/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, create and email' }))
    expect(await screen.findByText(/2 accounts created, 0 emails sent\. 2 emails didn't go out/)).toBeInTheDocument()
    expect(screen.getByTestId('status-ada.lovelace')).toHaveTextContent('Email failed')
    for (const body of posted) expect(document.body.textContent).not.toContain(body.password)

    await user.click(screen.getByRole('button', { name: 'Show passwords once' }))
    let dialog = await screen.findByRole('dialog', { name: 'Share these sign-in details' })
    expect(within(dialog).getByText('1 of 2 · Ada Lovelace')).toBeInTheDocument()
    expect(within(dialog).getByText(posted[0].password)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Share these sign-in details' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: "I've saved it" }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    dialog = await screen.findByRole('dialog', { name: 'Share these sign-in details' })
    expect(within(dialog).getByText('2 of 2 · Alan Turing')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: "I've saved it" }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(await screen.findByText(/That's every password/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show passwords once' })).not.toBeInTheDocument()
    for (const body of posted) expect(document.body.textContent).not.toContain(body.password)
  })
})

describe('"No, other options"', SLOW, () => {
  async function toOptions() {
    const { user } = await openChat()
    await answerTwoAsManagers(user)
    await user.click(screen.getByRole('button', { name: 'No, other options' }))
    expect(await screen.findByText('No problem. What would you like to do instead?')).toBeInTheDocument()
    return user
  }

  test('show each password once: created without any email relay, then one show-once dialog per account', async () => {
    relayOn()
    const user = await toOptions()
    await user.click(screen.getByRole('button', { name: /Show each password once/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Share these sign-in details' })
    expect(within(dialog).getByText('1 of 2 · Ada Lovelace')).toBeInTheDocument()
    expect(posted).toHaveLength(2)
    expect(relayed).toEqual([])
    expect(screen.getByText(/I'll show each password once so you can hand it over yourself/)).toBeInTheDocument()
  })

  test('create without sending: no relay, no password kept, a reminder about Reset password', async () => {
    relayOn()
    const user = await toOptions()
    await user.click(screen.getByRole('button', { name: /without sending passwords/ }))
    expect(await screen.findByText(/No sign-in details were sent: when you're ready, open each profile and use Reset password/))
      .toBeInTheDocument()
    expect(posted).toHaveLength(2)
    expect(relayed).toEqual([])
    expect(screen.queryByRole('button', { name: 'Show passwords once' })).not.toBeInTheDocument()
  })

  test('go back returns to the summary; cancel creates nothing', async () => {
    const user = await toOptions()
    await user.click(screen.getByRole('button', { name: 'Go back and change something' }))
    expect(await screen.findByRole('button', { name: 'Yes, create and email' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No, other options' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel — create nothing' }))
    expect(await screen.findByText('Okay, nothing was created.')).toBeInTheDocument()
    expect(posted).toEqual([])
  })
})

describe('leaving', SLOW, () => {
  test('Cancel with nothing typed goes straight back to Do it', async () => {
    const { user, panel } = await openChat()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await within(panel).findByTestId('puppy-actions')).toBeInTheDocument()
  })

  test('Cancel after answers asks first; Keep going keeps everything, Discard leaves', async () => {
    const { user, panel } = await openChat()
    await say(user, /names of the people/, 'Ada Lovelace')
    await screen.findByRole('textbox', { name: /email addresses/ })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText("Discard what you've entered? Nothing has been created yet.")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep going' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Keep going' }))
    expect(screen.getByRole('textbox', { name: /email addresses/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(await within(panel).findByTestId('puppy-actions')).toBeInTheDocument()
    expect(posted).toEqual([])
  })

  test('Esc closes Puppy right away when nothing was entered, and only after a confirm when something was', async () => {
    const { user } = await openChat()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /puppy/i })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    await user.click(within(panel).getByRole('tab', { name: 'Do it' }))
    await user.click(await within(panel).findByRole('button', { name: 'Create user accounts' }))
    await say(user, /names of the people/, 'Ada Lovelace')
    await screen.findByRole('textbox', { name: /email addresses/ })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: /puppy/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard and close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /puppy/i })).not.toBeInTheDocument())
  })
})
