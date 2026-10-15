import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AppProviders } from '../../app/providers.jsx'
import { makeQueryClient } from '../../app/queryClient.js'
import { SessionContext } from '../../auth/sessionContext.js'
import { users } from '../../test/render.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { resetAudio } from './audio.js'
import { FakeAudioContext } from './fakeAudio.js'
import Puppy from './Puppy.jsx'
import { SOUND_KEY } from './soundSettings.js'
import { TIPS_KEY } from './tips.js'
import { mondayOf } from '../../lib/format.js'

let contexts
class RecordingAudioContext extends FakeAudioContext {
  constructor() {
    super()
    contexts.push(this)
  }
}
const played = () => contexts.flatMap((c) => c.created)

beforeEach(() => {
  contexts = []
  window.AudioContext = RecordingAudioContext
  resetAudio()
  window.localStorage.clear()
  document.title = 'Scout'
})
afterEach(() => {
  delete window.AudioContext
})

const note = (id, type = 'OVER_40H', extra = {}) => ({ id, type, week_start: '2026-10-12', payload: {},
  subject_user: { id: 'u-eli', name: 'Eli Employee' }, message: `${type} ${id}`, created_at: `2026-10-15T09:00:0${id.length}Z`,
  read_at: null, ...extra })

function Where() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

/** Serve `list` as the unread notifications; returns a setter for the next polls. */
function serveNotifications(list) {
  let current = list
  server.use(http.get(`${API}/notifications`, () => HttpResponse.json(current)))
  return (next) => { current = next }
}

function renderPuppy(user = users.manager) {
  const client = makeQueryClient({ test: true })
  const session = { user, status: 'ready', login: async () => user, logout: async () => {}, changePassword: async () => user,
    setUser: () => {} }
  render(
    <AppProviders queryClient={client}>
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <Puppy />
          <button type="button">Somewhere else</button>
          <Where />
        </SessionContext.Provider>
      </MemoryRouter>
    </AppProviders>,
  )
  const poll = () => act(() => client.invalidateQueries({ queryKey: ['notifications'] }))
  return { client, poll }
}

/** Open the Puppy panel, on a tab other than Summary if asked. */
async function openPanel(tab) {
  await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
  const panel = await screen.findByRole('dialog', { name: /puppy/i })
  if (tab) await userEvent.click(within(panel).getByRole('tab', { name: tab }))
  return panel
}

beforeEach(() => {
  server.use(
    http.get(`${API}/approvals`, () => HttpResponse.json([
      { entry: { id: 'e1', work_date: '2026-10-12' }, user: { id: 'u-a' } },
      { entry: { id: 'e2', work_date: '2026-10-13' }, user: { id: 'u-b' } },
    ])),
    http.get(`${API}/insights/smart`, () => HttpResponse.json([1, 2, 3, 4].map((i) => ({ id: `i${i}`, severity: 'medium',
      title: `Insight ${i}`, detail: `Detail ${i}`, link: { to: 'project', id: `p${i}` } })))),
    http.get(`${API}/projects`, () => HttpResponse.json({ items: [], total: 0 })),
    http.get(`${API}/departments`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/allocations`, () => HttpResponse.json([])),
    http.get(`${API}/users`, () => HttpResponse.json({ items: [], total: 0 })),
  )
})

describe('Puppy in the header', () => {
  test('a round "Puppy assistant" button that perks up with a badge while notifications are unread', async () => {
    serveNotifications([note('a')])
    renderPuppy()
    const button = screen.getByRole('button', { name: 'Puppy assistant' })
    await waitFor(() => expect(button).toHaveAttribute('data-perked', 'true'))
    expect(within(button).getByTestId('puppy-badge')).toBeInTheDocument()
  })

  test('calm, ears down and no badge when everything is read', async () => {
    serveNotifications([])
    renderPuppy()
    const button = screen.getByRole('button', { name: 'Puppy assistant' })
    await waitFor(() => expect(button).toHaveAttribute('data-perked', 'false'))
    expect(within(button).queryByTestId('puppy-badge')).not.toBeInTheDocument()
  })

  test('the tab title carries the unread count, and can be switched off', async () => {
    serveNotifications([note('a'), note('bb')])
    renderPuppy()
    await waitFor(() => expect(document.title).toBe('(2) Scout'))
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Sound' }))
    await userEvent.click(screen.getByRole('switch', { name: /count in the tab title/i }))
    expect(document.title).toBe('Scout')
  })
})

describe('new notification alerts', () => {
  test('the first load is silent; a notification arriving later barks once, toasts and is announced', async () => {
    const next = serveNotifications([note('a')])
    const { poll } = renderPuppy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Puppy assistant' })).toHaveAttribute('data-perked', 'true'))
    await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' })) // the page has been interacted with
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(played()).toEqual([])

    next([note('bb'), note('a')])
    await poll()
    expect(await screen.findByRole('alert')).toHaveTextContent('Puppy: 1 new notification')
    expect(screen.getByTestId('puppy-announcement')).toHaveTextContent('Puppy: 1 new notification')
    // The bark: two noise bursts and two voices.
    expect(played().filter((n) => n.kind === 'buffer')).toHaveLength(2)

    // The same list again is not news.
    await poll()
    expect(played().filter((n) => n.kind === 'buffer')).toHaveLength(2)
  })

  test('before any click or key press the sound is blocked, and Puppy says once how to enable it', async () => {
    const next = serveNotifications([])
    const { poll } = renderPuppy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Puppy assistant' })).toHaveAttribute('data-perked', 'false'))
    next([note('a')])
    await poll()
    expect(await screen.findByRole('alert')).toHaveTextContent('Puppy: 1 new notification. Click anywhere to enable sounds.')
    expect(played()).toEqual([])
  })

  test('muted: the toast and announcement still come, without a sound', async () => {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify({ muted: true }))
    const next = serveNotifications([])
    const { poll } = renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Puppy assistant' })).toHaveAttribute('data-perked', 'false'))
    next([note('a'), note('bb')])
    await poll()
    expect(await screen.findByRole('alert')).toHaveTextContent('Puppy: 2 new notifications')
    expect(screen.getByTestId('puppy-announcement')).toHaveTextContent('Puppy: 2 new notifications')
    expect(played()).toEqual([])
  })

  test('"only in the background": no sound while the tab is visible', async () => {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify({ backgroundOnly: true }))
    const next = serveNotifications([])
    const { poll } = renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Puppy assistant' })).toHaveAttribute('data-perked', 'false'))
    next([note('a')])
    await poll()
    expect(await screen.findByRole('alert')).toHaveTextContent('Puppy: 1 new notification')
    expect(played()).toEqual([])
  })
})

describe('the Puppy panel', () => {
  test('summarises what needs attention in sentences, shows the top 3 insights and is honest about being rule-based', async () => {
    serveNotifications([note('a', 'OVER_40H'), note('k', 'KICKBACK_RAISED', { message: 'Morgan sent API back to you' })])
    renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    expect(within(panel).getByText('Puppy · your rule-based assistant')).toBeInTheDocument()
    expect(within(panel).getByText('Puppy follows rules from your data — no AI service involved.')).toBeInTheDocument()
    expect(await within(panel).findByText('2 timesheets are waiting for your approval')).toBeInTheDocument()
    expect(within(panel).getByText(/Eli Employee went over 40 hours/)).toBeInTheDocument()
    expect(within(panel).getByText('Morgan sent API back to you')).toBeInTheDocument()
    expect(await within(panel).findByText('Insight 3')).toBeInTheDocument()
    expect(within(panel).queryByText('Insight 4')).not.toBeInTheDocument()
  })

  test('quick actions are role-aware and go where they say', async () => {
    serveNotifications([])
    renderPuppy(users.employee)
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    expect(await within(panel).findByText(/all caught up/i)).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Open timesheets' })).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Open timesheet' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/timesheet')
  })

  test('a summary sentence opens its page', async () => {
    serveNotifications([])
    renderPuppy()
    const panel = await openPanel()
    await userEvent.click(await within(panel).findByRole('button', { name: /timesheets are waiting/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/timesheets')
  })

  test('a tip offers to open this week\'s empty timesheet, and a dismissed tip stays gone', async () => {
    const week = mondayOf(new Date())
    serveNotifications([note('t', 'TIMESHEET_EMPTY', { week_start: week, subject_user: { id: users.employee.id, name: 'Eli' } })])
    renderPuppy(users.employee)
    let panel = await openPanel()
    const tips = await within(panel).findByRole('list', { name: 'Tips from Puppy' })
    expect(tips).toHaveTextContent('Your timesheet for this week is empty — want me to open it?')
    await userEvent.click(within(tips).getByRole('button', { name: 'Dismiss tip' }))
    expect(within(panel).queryByRole('list', { name: 'Tips from Puppy' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(TIPS_KEY))).toEqual([`timesheet-empty:${week}`])
    await userEvent.keyboard('{Escape}')
    panel = await openPanel()
    await within(panel).findByText(/timesheet for this week is empty$/)
    expect(within(panel).queryByRole('list', { name: 'Tips from Puppy' })).not.toBeInTheDocument()
  })

  test('"What Puppy can see" explains the rules', async () => {
    serveNotifications([])
    renderPuppy()
    const panel = await openPanel()
    await userEvent.click(within(panel).getByRole('button', { name: 'What Puppy can see' }))
    expect(within(panel).getByText(/Never pay, hourly rates, costs per person, passwords/)).toBeVisible()
    expect(within(panel).getByText(/never sends, stores or logs them/)).toBeVisible()
  })

  test('Ask Puppy reads a question with the palette\'s rules, shows how it read it and goes there', async () => {
    serveNotifications([])
    renderPuppy()
    const panel = await openPanel('Ask')
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), "what's at risk?{Enter}")
    expect(await within(panel).findByText('Projects · At risk')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects?at_risk=true'))
  })

  test('a question Puppy has no rule for gets an honest answer and examples to try', async () => {
    serveNotifications([])
    renderPuppy()
    const panel = await openPanel('Ask')
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), 'tell me a joke{Enter}')
    expect(await within(panel).findByText(/doesn't have a rule for that/i)).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'who is over 40' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/allocation'))
  })

  test('Ask Puppy explains how Scout works, and refuses private details politely', async () => {
    serveNotifications([])
    renderPuppy()
    const panel = await openPanel('Ask')
    const box = within(panel).getByRole('textbox', { name: 'Ask Puppy' })
    await userEvent.type(box, 'how is progress calculated?{Enter}')
    expect(await within(panel).findByText(/easy 1, medium 2, hard 3/)).toBeInTheDocument()
    await userEvent.clear(box)
    await userEvent.type(box, "what's Eli's salary?{Enter}")
    expect(await within(panel).findByText('I keep pay and private details out of reach — ask an admin through the proper page.'))
      .toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  test('the question never leaves the browser: no request and no storage carries it', async () => {
    const seen = []
    const record = ({ request }) => { seen.push(request.url); request.clone().text().then((t) => seen.push(t)).catch(() => {}) }
    server.events.on('request:start', record)
    try {
      serveNotifications([])
      renderPuppy()
      const panel = await openPanel('Ask')
      await userEvent.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), 'zebra42 secret plans{Enter}')
      await within(panel).findByText(/doesn't have a rule for that/i)
      await waitFor(() => expect(seen.length).toBeGreaterThan(0))
      expect(seen.join(' ')).not.toMatch(/zebra42/)
      expect(JSON.stringify({ ...window.localStorage })).not.toMatch(/zebra42/)
    } finally {
      server.events.removeListener('request:start', record)
    }
  })
})

describe('do-it-for-me actions always ask first', () => {
  test('Mark all read says how many, does nothing on Cancel, and marks them read as you on Confirm', async () => {
    let calls = 0
    server.use(http.post(`${API}/notifications/read-all`, () => { calls += 1; return HttpResponse.json({ updated: 2 }) }))
    serveNotifications([note('a'), note('bb')])
    renderPuppy()
    const panel = await openPanel('Do it')
    await userEvent.click(await within(panel).findByRole('button', { name: 'Mark all notifications read' }))
    expect(within(panel).getByText('Puppy will mark 2 notifications as read.')).toBeInTheDocument()
    expect(calls).toBe(0)
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(calls).toBe(0)
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark all notifications read' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls).toBe(1))
    expect(await screen.findByText('Puppy marked 2 notifications as read')).toBeInTheDocument()
  })

  test("opening this week's timesheet goes there only after Confirm", async () => {
    serveNotifications([])
    renderPuppy(users.employee)
    const panel = await openPanel('Do it')
    await userEvent.click(within(panel).getByRole('button', { name: "Open this week's timesheet" }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`/timesheet?week=${mondayOf(new Date())}`)
  })

  test('an employee can start a message to their manager: Puppy opens compose, the person still sends', async () => {
    server.use(http.get(`${API}/messages/contacts`, () => HttpResponse.json({ can_group: false,
      items: [{ id: 'u-mgr', name: 'Morgan Manager', first_name: 'Morgan', last_name: 'Manager', relation: 'Your manager' }] })))
    serveNotifications([])
    renderPuppy(users.employee)
    const panel = await openPanel('Do it')
    await userEvent.click(await within(panel).findByRole('button', { name: 'Message Morgan' }))
    expect(within(panel).getByText('Puppy will start a new message to Morgan Manager. You write it and press Send.')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/messages?to=u-mgr')
  })

  test('asking for an action shows the same confirmation; Cancel leaves everything alone', async () => {
    let calls = 0
    server.use(http.post(`${API}/notifications/read-all`, () => { calls += 1; return HttpResponse.json({ updated: 1 }) }))
    serveNotifications([note('a')])
    renderPuppy()
    const panel = await openPanel('Ask')
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), 'mark all as read{Enter}')
    expect(await within(panel).findByText('Puppy will mark 1 notification as read.')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(within(panel).getByText('Okay, Puppy left it alone.')).toBeInTheDocument()
    expect(calls).toBe(0)
  })

  test('executives (read-only) are never offered timesheet or approval actions', async () => {
    serveNotifications([note('a')])
    renderPuppy(users.executive)
    const panel = await openPanel('Do it')
    const labels = within(panel).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toContain('Mark all notifications read')
    expect(labels).not.toContain("Open this week's timesheet")
    expect(labels).not.toContain('Open pending approvals')
    expect(labels.join(' ')).not.toMatch(/approve|reject|archive|delete/i)
  })
})

describe.each(Object.keys(users))('safeguards on screen for the %s', (role) => {
  const LEAK = 'LEAKED'
  const secret = { salary: `${LEAK}-salary`, hourly_rate: `${LEAK}-rate`, temp_password: `${LEAK}-temp`, code: `${LEAK}-code`,
    email: `${LEAK}@acme.example`, body: `${LEAK}-body`, phone: `${LEAK}-phone`, changes: { salary: `${LEAK}-audit` } }

  test('no salary, rate, password, code, email or message body is ever shown', async () => {
    server.use(
      http.get(`${API}/approvals`, () => HttpResponse.json([{ entry: { id: 'e1', work_date: '2026-10-01', hourly_rate: `${LEAK}-rate` },
        user: { id: 'u-a', name: 'Ann', ...secret }, ...secret }])),
      http.get(`${API}/insights/smart`, () => HttpResponse.json([{ id: 'i1', severity: 'high', title: 'Budget burn',
        detail: `Contact ${LEAK}x@acme.example`, link: { to: 'project', id: 'p1' }, ...secret }])),
      http.get(`${API}/projects`, () => HttpResponse.json({ items: [{ id: 'p1', name: 'Atlas', status: 'active',
        at_risk_reasons: ['PAST_DUE'], ...secret }], total: 1 })),
      http.get(`${API}/projects/p1/milestones`, () => HttpResponse.json([{ id: 'm1', name: 'Cutover', project_id: 'p1',
        priority: 'critical', status: 'in_progress', end_date: '2099-01-01', ...secret }])),
      http.get(`${API}/users`, () => HttpResponse.json({ items: [{ id: 'u-a', first_name: 'Ann', last_name: 'A', ...secret }] })),
      http.get(`${API}/messages/contacts`, () => HttpResponse.json({ can_group: false,
        items: [{ id: 'u-mgr', name: 'Morgan Manager', relation: 'Your manager', ...secret }] })),
      http.get(`${API}/messages/unread-count`, () => HttpResponse.json({ unread: 2, conversations: 1 })),
      http.get(`${API}/timesheet-reminders`, () => HttpResponse.json({ week_start: '2026-10-12', due: true,
        people: [{ id: 'u-a', name: 'Ann', ...secret }] })),
    )
    serveNotifications([
      note('m', 'MESSAGE_RECEIVED', { payload: { conversation_id: 'c1', name: 'Morgan Manager', subject: `${LEAK}-subject`, ...secret },
        subject_user: { id: 'u-mgr', name: 'Morgan Manager', ...secret } }),
      note('h', 'HR_SUBMISSION', { message: `Form from ${LEAK}y@acme.example, temporary password ${LEAK}pw, code 482913`,
        payload: { ...secret } }),
    ])
    renderPuppy(users[role])
    const panel = await openPanel()
    await within(panel).findByText(/unread messages? from Morgan/)
    await within(panel).findByText('Budget burn')
    expect(document.body.textContent).not.toMatch(new RegExp(`${LEAK}|482913`))
    await userEvent.click(within(panel).getByRole('tab', { name: 'Do it' }))
    await within(panel).findByRole('button', { name: /Atlas/ })
    // Every action's confirmation sentence, too.
    // (Create user accounts is a conversation with its own confirmation, tested in createUsersChat.test.jsx.)
    const list = within(panel).getByTestId('puppy-actions')
    const confirmable = () => within(list).getAllByRole('button').filter((b) => b.textContent !== 'Create user accounts')
    const count = confirmable().length
    for (let i = 0; i < count; i += 1) {
      await userEvent.click(confirmable()[i])
      expect(within(list).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(new RegExp(`${LEAK}|482913`))
      await userEvent.click(within(list).getByRole('button', { name: 'Cancel' }))
    }
  })
})

describe('sound settings', () => {
  test('pick a sound, preview it, set the volume and mute; the choice is kept in this browser', async () => {
    serveNotifications([])
    renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Sound' }))
    const options = screen.getAllByRole('radio').map((r) => r.closest('label').textContent)
    expect(options).toEqual(['Puppy bark', 'Soft chime', 'Ping', 'Pop', 'None'])
    expect(screen.getByRole('radio', { name: 'Puppy bark' })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: 'Soft chime' }))
    await userEvent.click(screen.getByRole('button', { name: 'Preview Soft chime' }))
    expect(played().filter((n) => n.kind === 'oscillator')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Preview None' })).not.toBeInTheDocument()

    const volume = screen.getByRole('slider', { name: 'Volume' })
    volume.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.click(screen.getByRole('switch', { name: 'Mute Puppy' }))
    await userEvent.click(screen.getByRole('switch', { name: /only when the tab is in the background/i }))
    const stored = JSON.parse(window.localStorage.getItem(SOUND_KEY))
    expect(stored).toMatchObject({ sound: 'chime', muted: true, backgroundOnly: true })
    expect(stored.volume).toBeCloseTo(0.5)
  })
})
