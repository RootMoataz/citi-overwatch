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
    expect(within(panel).queryByRole('button', { name: 'Open approvals' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Open timesheet' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/timesheet')
  })

  test('a summary sentence opens its page; Mark all read clears the notifications', async () => {
    let cleared = false
    server.use(http.post(`${API}/notifications/read-all`, () => { cleared = true; return HttpResponse.json({ updated: 1 }) }))
    serveNotifications([note('a', 'TIMESHEET_EMPTY', { subject_user: { id: users.manager.id, name: 'Morgan Manager' } })])
    renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(cleared).toBe(true))
    await userEvent.click(within(panel).getByRole('button', { name: /timesheets are waiting/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/approvals')
  })

  test('Ask Puppy reads a question with the palette\'s rules, shows how it read it and goes there', async () => {
    serveNotifications([])
    renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), "what's at risk?{Enter}")
    expect(await within(panel).findByText('Projects · At risk')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects?at_risk=true'))
  })

  test('a question Puppy has no rule for gets an honest answer and examples to try', async () => {
    serveNotifications([])
    renderPuppy()
    await userEvent.click(screen.getByRole('button', { name: 'Puppy assistant' }))
    const panel = await screen.findByRole('dialog', { name: /puppy/i })
    await userEvent.type(within(panel).getByRole('textbox', { name: 'Ask Puppy' }), 'tell me a joke{Enter}')
    expect(await within(panel).findByText(/doesn't have a rule for that/i)).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'who is over 40' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/allocation'))
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
