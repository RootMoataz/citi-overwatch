import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import NotificationBell from '../../components/NotificationBell.jsx'
import Layout from '../../app/Layout.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, renderWithProviders, users } from '../../test/render.jsx'
import { setViewport } from '../../test/setup.js'
import MilestonesTab from '../milestones/MilestonesTab.jsx'
import DiscussButton from './DiscussButton.jsx'
import MessageButton from './MessageButton.jsx'
import MessagesPage from './MessagesPage.jsx'

const person = (u, extra = {}) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`, first_name: u.first_name,
  last_name: u.last_name, role: u.role, job_title: '', is_archived: false, avatar_url: null, last_read_at: null, ...extra })
const mgr = person(users.manager)
const emp = person(users.employee)
const ana = { ...person({ id: 'u-ana', first_name: 'Ana', last_name: 'Ruiz', role: 'employee' }) }

const recent = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString()

const direct = {
  id: 'c1', subject: null, is_group: false, milestone: null, created_at: recent(60), last_activity_at: recent(2),
  last_read_at: recent(30), participants: [mgr, emp], unread_count: 2,
  last_message: { id: 'm3', body: 'Flag anything that does not parse', created_at: recent(2), sender: { id: mgr.id, name: mgr.name } },
}
const discussion = {
  id: 'c2', subject: 'Schema Mapping · Apollo', is_group: true, created_at: recent(300), last_activity_at: recent(200),
  milestone: { id: 'ms1', name: 'Schema Mapping', project: { id: 'p1', name: 'Apollo' } }, last_read_at: recent(100),
  participants: [mgr, emp, ana], unread_count: 0,
  last_message: { id: 'd2', body: 'I take the transaction tables', created_at: recent(200), sender: { id: ana.id, name: ana.name } },
}

const msg = (id, sender, body, minutesAgo) => ({ id, conversation_id: 'c1', body, created_at: recent(minutesAgo),
  sender: { id: sender.id, name: sender.name } })

function inbox(items = [direct, discussion]) {
  return http.get(`${API}/conversations`, () => HttpResponse.json({ items }))
}

function threadHandler(conversation, items, calls = {}) {
  return http.get(`${API}/conversations/${conversation.id}/messages`, ({ request }) => {
    calls.urls = [...(calls.urls ?? []), request.url]
    return HttpResponse.json({ items, has_more: false, conversation })
  })
}

function renderPage(user, route = '/messages') {
  return renderAsUser(<MessagesPage />, { user, route, path: '/messages/:id?' })
}

describe('the inbox', () => {
  test('lists conversations with names, previews and unread counts, newest first', async () => {
    server.use(inbox())
    renderPage(users.employee)
    const list = await screen.findByRole('list', { name: 'Conversations' })
    const rows = within(list).getAllByRole('link')
    expect(rows[0]).toHaveTextContent('Morgan Manager')
    expect(rows[0]).toHaveTextContent('Flag anything that does not parse')
    expect(within(rows[0]).getByLabelText('2 unread')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Schema Mapping · Apollo')
    expect(rows[1]).toHaveTextContent('Ana: I take the transaction tables')
    expect(within(rows[1]).getByLabelText('Milestone discussion')).toBeInTheDocument()
    await userEvent.click(rows[0])
    expect(screen.getByTestId('location')).toHaveTextContent('/messages/c1')
  })

  test('an empty inbox invites a first message', async () => {
    server.use(inbox([]))
    renderPage(users.manager)
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument()
  })
})

describe('a conversation', () => {
  const items = [msg('m1', mgr, 'How is it going?', 40), msg('m2', emp, 'Nearly there\nAddresses left', 30),
    msg('m3', mgr, '<b>Flag</b> anything that does not parse', 2)]

  test('shows my messages on one side, theirs on the other, as plain text, and marks it read', async () => {
    let read = 0
    server.use(inbox(), threadHandler(direct, items),
      http.post(`${API}/conversations/c1/read`, () => { read += 1; return HttpResponse.json({ conversation_id: 'c1', last_read_at: recent(0) }) }))
    renderPage(users.employee, '/messages/c1')
    const log = await screen.findByRole('log', { name: 'Messages' })
    expect(await within(log).findByText('How is it going?')).toBeInTheDocument()
    // Markup in a message is shown as typed, never interpreted; line breaks are kept.
    expect(within(log).getByText('<b>Flag</b> anything that does not parse')).toBeInTheDocument()
    expect(log.querySelector('b')).toBeNull()
    expect(within(log).getByText(/Nearly there/).textContent).toBe('Nearly there\nAddresses left')
    expect(within(log).getByRole('separator', { name: 'Today' })).toBeInTheDocument()
    await waitFor(() => expect(read).toBe(1))
  })

  test('says "Seen" under my last message once everyone has read it', async () => {
    const seen = { ...direct, participants: [mgr, { ...emp, last_read_at: recent(0) }] }
    server.use(inbox(), threadHandler(seen, items.slice(0, 1)))
    renderPage(users.manager, '/messages/c1')
    expect(await screen.findByText(/Seen/)).toBeInTheDocument()
  })

  test('no "Seen" while the other person has not read it', async () => {
    server.use(inbox(), threadHandler(direct, items.slice(0, 1)))
    renderPage(users.manager, '/messages/c1')
    await screen.findByText('How is it going?')
    expect(screen.queryByText(/Seen/)).not.toBeInTheDocument()
  })

  test('Enter sends, Shift+Enter adds a line, and a refusal keeps the text and shows the reason', async () => {
    const sent = []
    let fail = false
    server.use(inbox(), threadHandler(direct, items),
      http.post(`${API}/conversations/c1/read`, () => HttpResponse.json({})),
      http.post(`${API}/conversations/c1/messages`, async ({ request }) => {
        const body = await request.json()
        if (fail) return HttpResponse.json({ error: { code: 'RATE_LIMITED', message: "You're sending messages too fast." } }, { status: 429 })
        sent.push(body.body)
        return HttpResponse.json({ id: 'new', body: body.body }, { status: 201 })
      }))
    renderPage(users.employee, '/messages/c1')
    const box = await screen.findByRole('textbox', { name: 'Message' })
    await userEvent.type(box, 'First line{Shift>}{Enter}{/Shift}second line{Enter}')
    await waitFor(() => expect(sent).toEqual(['First line\nsecond line']))
    await waitFor(() => expect(box).toHaveValue(''))
    fail = true
    await userEvent.type(box, 'Too fast{Enter}')
    expect(await screen.findByText("You're sending messages too fast.")).toBeInTheDocument()
    expect(box).toHaveValue('Too fast')
  })

  test('the send button waits for something to send, and the counter warns near the limit', async () => {
    server.use(inbox(), threadHandler(direct, items))
    renderPage(users.employee, '/messages/c1')
    const box = await screen.findByRole('textbox', { name: 'Message' })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.click(box)
    await userEvent.paste('x'.repeat(2005))
    expect(screen.getByText('5 over the limit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  test('a Discuss thread names its people and links to its milestone', async () => {
    const lines = [{ ...msg('d1', mgr, 'Kick-off', 300), conversation_id: 'c2' }, { ...msg('d2', ana, 'Transactions are mine', 200), conversation_id: 'c2' }]
    server.use(inbox(), threadHandler(discussion, lines))
    renderPage(users.employee, '/messages/c2')
    expect(await screen.findByRole('heading', { name: 'Schema Mapping · Apollo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /milestone schema mapping in apollo/i })).toHaveAttribute('href', '/projects/p1?tab=milestones')
    // In a group, other people's messages carry their name.
    const log = screen.getByRole('log', { name: 'Messages' })
    expect(within(log).getByText('Ana Ruiz')).toBeInTheDocument()
  })

  test("a conversation you're not in says so instead of breaking", async () => {
    server.use(inbox(), http.get(`${API}/conversations/zz/messages`, () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })))
    renderPage(users.employee, '/messages/zz')
    expect(await screen.findByText("This conversation isn't available")).toBeInTheDocument()
  })

  test('on a phone the thread replaces the list and Back returns to it', async () => {
    setViewport(390)
    server.use(inbox(), threadHandler(direct, items))
    renderPage(users.employee, '/messages/c1')
    await screen.findByRole('log', { name: 'Messages' })
    expect(screen.queryByRole('list', { name: 'Conversations' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to conversations' }))
    expect(await screen.findByRole('list', { name: 'Conversations' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/messages$/)
  })
})

describe('a new message', () => {
  const employeeContacts = { items: [{ ...mgr, relation: 'Your manager' },
    { ...person({ id: 'u-pm', first_name: 'Pat', last_name: 'Pm', role: 'manager' }), relation: 'Manages Apollo' },
    { ...ana, relation: 'Colleague · Engineering' }], can_group: false }

  test('employees pick from their managers and colleagues, with a hint, and land in the new conversation', async () => {
    let posted
    server.use(inbox([]), http.get(`${API}/messages/contacts`, () => HttpResponse.json(employeeContacts)),
      http.post(`${API}/conversations`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ ...direct, id: 'c9' }, { status: 201 })
      }))
    renderPage(users.employee)
    await userEvent.click(await screen.findByRole('button', { name: 'New message' }))
    const dialog = await screen.findByRole('dialog', { name: 'New message' })
    expect(await within(dialog).findByText('You can message your manager, your project managers and other employees.'))
      .toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/subject/i)).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('combobox', { name: /to/i }))
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent('Morgan ManagerYour manager')
    expect(options[1]).toHaveTextContent('Pat PmManages Apollo')
    expect(options[2]).toHaveTextContent('Ana RuizColleague · Engineering')
    await userEvent.click(options[0])
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'Can we talk about Thursday?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/messages/c9'))
    expect(posted).toEqual({ participant_ids: [mgr.id], body: 'Can we talk about Thursday?' })
  })

  test('a Message link to someone an employee may not write to explains why', async () => {
    server.use(inbox([]), http.get(`${API}/messages/contacts`, () => HttpResponse.json(employeeContacts)))
    renderPage(users.employee, '/messages?to=u-admin')
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Employees can message their manager, their project managers and other employees.')
  })

  test('a Message link opens the existing one-to-one instead of a new one', async () => {
    server.use(inbox(), threadHandler(direct, []))
    renderPage(users.employee, `/messages?to=${mgr.id}`)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/messages/c1'))
  })

  test('managers can write to several people with a subject', async () => {
    let posted
    const everyone = { items: [emp, ana, person(users.admin)], can_group: true }
    server.use(inbox([]), http.get(`${API}/messages/contacts`, () => HttpResponse.json(everyone)),
      http.post(`${API}/conversations`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ ...discussion, id: 'c7' }, { status: 201 })
      }))
    renderPage(users.manager, '/messages?compose')
    const dialog = await screen.findByRole('dialog', { name: 'New message' })
    const to = await within(dialog).findByRole('combobox', { name: /to/i })
    await userEvent.click(to)
    await userEvent.click(await screen.findByRole('option', { name: /Eli Employee/ }))
    await userEvent.click(to)
    await userEvent.click(await screen.findByRole('option', { name: /Ana Ruiz/ }))
    expect(within(dialog).queryByText(/You can message your manager/)).not.toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(/subject/i), 'Release plan')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'Kick-off at 10')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(posted).toEqual({ participant_ids: [emp.id, ana.id], subject: 'Release plan', body: 'Kick-off at 10' }))
  })

  test('the server refusing a recipient is shown in the dialog', async () => {
    server.use(inbox([]), http.get(`${API}/messages/contacts`, () => HttpResponse.json(employeeContacts)),
      http.post(`${API}/conversations`, () => HttpResponse.json(
        { error: { code: 'MESSAGING_NOT_ALLOWED',
          message: 'Employees can message their manager, their project managers and other employees.' } }, { status: 403 })))
    renderPage(users.employee, '/messages?compose')
    const dialog = await screen.findByRole('dialog', { name: 'New message' })
    await userEvent.click(await within(dialog).findByRole('combobox', { name: /to/i }))
    await userEvent.click((await screen.findAllByRole('option'))[1])
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'Hi')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send' }))
    expect(await within(dialog).findByRole('alert'))
      .toHaveTextContent('Employees can message their manager, their project managers and other employees.')
  })
})

describe('Message buttons', () => {
  test('only appear for people the viewer may message', async () => {
    const admin = person(users.admin)
    server.use(http.get(`${API}/messages/contacts`, () => HttpResponse.json(
      { items: [{ ...mgr, relation: 'Your manager' }, { ...ana, relation: 'Colleague · Engineering' }], can_group: false })))
    renderAsUser(<><MessageButton person={mgr} /><MessageButton person={ana} /><MessageButton person={admin} /></>,
      { user: users.employee })
    const button = await screen.findByRole('link', { name: 'Message Morgan Manager' })
    expect(button).toHaveAttribute('href', `/messages?to=${mgr.id}`)
    // A fellow employee gets a Message button; an admin (not on an employee's list) does not.
    expect(screen.getByRole('link', { name: 'Message Ana Ruiz' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: `Message ${admin.name}` })).not.toBeInTheDocument()
  })

  test('never for yourself', async () => {
    server.use(http.get(`${API}/messages/contacts`, () => HttpResponse.json({ items: [emp], can_group: true })))
    renderAsUser(<MessageButton person={mgr} />, { user: users.manager })
    await waitFor(() => expect(screen.queryByRole('link')).not.toBeInTheDocument())
  })
})

describe('Discuss on a milestone', () => {
  const milestone = { id: 'ms1', name: 'Schema Mapping', assignees: [{ id: emp.id, name: emp.name }] }

  test('the manager starts the discussion and is taken to it', async () => {
    server.use(http.post(`${API}/milestones/ms1/discussion`, () => HttpResponse.json({ ...discussion }, { status: 201 })))
    renderAsUser(<DiscussButton milestone={milestone} manage conversations={[]} />, { user: users.manager })
    await userEvent.click(screen.getByRole('button', { name: 'Discuss Schema Mapping' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/messages/c2'))
  })

  test("needs someone assigned first", () => {
    renderAsUser(<DiscussButton milestone={{ ...milestone, assignees: [] }} manage conversations={[]} />, { user: users.manager })
    expect(screen.getByRole('button', { name: 'Discuss Schema Mapping' })).toBeDisabled()
  })

  test('assignees open an existing discussion and see nothing when there is none', () => {
    const { unmount } = renderAsUser(<DiscussButton milestone={milestone} manage={false} conversations={[discussion]} />, { user: users.employee })
    expect(screen.getByRole('link', { name: /open the discussion about schema mapping/i })).toHaveAttribute('href', '/messages/c2')
    unmount()
    renderAsUser(<DiscussButton milestone={milestone} manage={false} conversations={[]} />, { user: users.employee })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('milestone cards show it beside Notes', async () => {
    const project = { id: 'p1', name: 'Apollo', start_date: '2026-01-01', predicted_end_date: '2026-12-31', status: 'active',
      manager: { id: users.manager.id, name: 'Morgan Manager' }, at_risk_reasons: [] }
    server.use(inbox([discussion]),
      http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([{ id: 'ms1', project_id: 'p1', name: 'Schema Mapping',
        description: '', status: 'in_progress', display_status: 'in_progress', blocked: false, predecessors: [],
        assignees: [{ id: emp.id, name: emp.name }], is_assignee: true, start_date: '2026-03-01', end_date: '2026-06-30',
        difficulty: 'medium', is_archived: false }])),
      http.get(`${API}/projects/p1/members`, () => HttpResponse.json([])))
    renderAsUser(<MilestonesTab project={project} manage={false} />, { user: users.employee })
    expect(await screen.findByRole('link', { name: /open the discussion about schema mapping/i })).toBeInTheDocument()
  })
})

describe('the rest of the app', () => {
  test('the bell says who wrote and opens the conversation', async () => {
    server.use(http.get(`${API}/notifications`, () => HttpResponse.json([{ id: 'n1', type: 'MESSAGE_RECEIVED',
      message: 'Morgan Manager sent you a message', payload: { conversation_id: 'c1' }, subject_user: { id: mgr.id, name: mgr.name } }])),
    http.post(`${API}/notifications/n1/read`, () => HttpResponse.json({ id: 'n1', read: true })))
    renderAsUser(<NotificationBell />, { user: users.employee })
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Morgan Manager sent you a message/ }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/messages/c1'))
  })

  test('the sidebar has Messages with its unread count, a dot when collapsed', async () => {
    const renderNav = () => renderWithProviders(
      <Routes><Route element={<Layout user={users.employee} badges={{ '/messages': 3 }} />}><Route path="/" element={<p>Home</p>} /></Route></Routes>)
    const { unmount } = renderNav()
    const link = screen.getByRole('link', { name: /messages/i })
    expect(link).toHaveAttribute('href', '/messages')
    expect(within(link).getByLabelText('3 unread')).toBeInTheDocument()
    unmount()
    localStorage.setItem('overwatch.sidebarCollapsed', 'true')
    renderNav()
    expect(screen.getByRole('link', { name: 'Messages (3 unread)' })).toBeInTheDocument()
  })
})
