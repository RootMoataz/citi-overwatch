import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { API, HttpResponse, http, server } from '../../test/server.js'
import { renderAsUser, users } from '../../test/render.jsx'
import LiveActivityCard from './LiveActivityCard.jsx'

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString()
const items = [
  { id: 'e1', created_at: minutesAgo(2), action: 'approve', entity_type: 'time_entry',
    actor: { id: 'u-mgr', name: 'Morgan Manager' }, verb: 'approved 9h for Eli Employee on',
    object: { type: 'milestone', id: 'm1', name: 'Schema Mapping' }, tail: null, project: { id: 'p1', name: 'Apollo' },
    sentence: 'Morgan Manager approved 9h for Eli Employee on Schema Mapping' },
  { id: 'e2', created_at: minutesAgo(90), action: 'status_change', entity_type: 'milestone',
    actor: { id: null, name: 'System' }, verb: 'moved', object: { type: 'milestone', id: 'm2', name: 'Cutover' },
    tail: 'to In progress', project: { id: 'p1', name: 'Apollo' }, sentence: 'System moved Cutover to In progress' },
]

describe('LiveActivityCard', () => {
  test('lists the latest events as sentences with avatars, links and relative times', async () => {
    const seen = []
    server.use(http.get(`${API}/activity`, ({ request }) => {
      seen.push(Object.fromEntries(new URL(request.url).searchParams))
      return HttpResponse.json({ items })
    }))
    renderAsUser(<LiveActivityCard department="d1" />, { user: users.admin })
    const list = await screen.findByRole('list', { name: 'Recent activity' })
    const [first, second] = within(list).getAllByRole('listitem')
    expect(first).toHaveTextContent('Morgan Manager approved 9h for Eli Employee on Schema Mapping')
    expect(first).toHaveTextContent('Apollo · 2 min ago')
    expect(within(first).getByRole('link', { name: 'Schema Mapping' })).toHaveAttribute('href', '/projects/p1?tab=milestones&milestone=m1')
    expect(within(first).getByRole('link', { name: 'Morgan Manager' })).toHaveAttribute('href', '/people/u-mgr/profile')
    expect(second).toHaveTextContent('System moved Cutover to In progress')
    expect(second).toHaveTextContent('2 h ago')
    expect(within(second).getByTestId('SettingsOutlinedIcon')).toBeInTheDocument()
    await waitFor(() => expect(seen[0]).toMatchObject({ department: 'd1', limit: '12' }))
  })

  test('a manager sees names as plain text unless the profile is theirs to open', async () => {
    server.use(http.get(`${API}/activity`, () => HttpResponse.json({ items: [{ ...items[0], actor: { id: 'u-other', name: 'Olive Other' } }] })))
    renderAsUser(<LiveActivityCard />, { user: users.manager })
    const list = await screen.findByRole('list', { name: 'Recent activity' })
    expect(within(list).queryByRole('link', { name: 'Olive Other' })).not.toBeInTheDocument()
    expect(within(list).getByText('Olive Other')).toBeInTheDocument()
  })

  test('says so when nothing has happened', async () => {
    server.use(http.get(`${API}/activity`, () => HttpResponse.json({ items: [] })))
    renderAsUser(<LiveActivityCard />, { user: users.executive })
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument()
  })
})
