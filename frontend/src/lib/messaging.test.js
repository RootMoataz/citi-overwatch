import { describe, expect, test } from 'vitest'
import { mergeMessages } from '../api/messages.js'
import {
  BODY_LIMIT, bubbleGroups, canMessage, conversationTitle, counterText, dayLabel, directWith, isSeen, others, previewLine,
  shouldSendOnKey,
} from './messaging.js'

const me = { id: 'u-me', first_name: 'Morgan', last_name: 'Manager' }
const eli = { id: 'u-eli', name: 'Eli Employee', last_read_at: null }
const ana = { id: 'u-ana', name: 'Ana Ruiz', last_read_at: null }
const self = { id: 'u-me', name: 'Morgan Manager', last_read_at: '2026-10-14T10:00:00Z' }

describe('who the Message button shows for', () => {
  const contacts = { items: [{ id: 'u-boss' }, { id: 'u-eli' }], can_group: false }

  test('anyone on the contact list, and nobody else', () => {
    expect(canMessage(contacts, { id: 'u-boss' }, me)).toBe(true)
    expect(canMessage(contacts, { id: 'u-eli' }, me)).toBe(true)
    expect(canMessage(contacts, { id: 'u-admin' }, me)).toBe(false)
  })

  test('never yourself, nobody before the list loads and nobody without an id', () => {
    expect(canMessage({ items: [{ id: 'u-me' }] }, { id: 'u-me' }, me)).toBe(false)
    expect(canMessage(undefined, { id: 'u-boss' }, me)).toBe(false)
    expect(canMessage(contacts, {}, me)).toBe(false)
    expect(canMessage(contacts, null, me)).toBe(false)
  })
})

describe('conversation titles', () => {
  test('a one-to-one conversation is named after the other person', () => {
    expect(conversationTitle({ participants: [self, eli] }, me)).toBe('Eli Employee')
  })

  test('a group uses its subject, or else everyone else by name', () => {
    expect(conversationTitle({ is_group: true, subject: 'Release plan', participants: [self, eli, ana] }, me)).toBe('Release plan')
    expect(conversationTitle({ is_group: true, participants: [self, eli, ana] }, me)).toBe('Eli Employee, Ana Ruiz')
  })

  test('others leaves the viewer out', () => {
    expect(others({ participants: [self, eli] }, me)).toEqual([eli])
  })
})

describe('previews', () => {
  test('my own last message starts with "You:"', () => {
    const conv = { participants: [self, eli], last_message: { body: 'Hi', sender: { id: 'u-me', name: 'Morgan Manager' } } }
    expect(previewLine(conv, me)).toBe('You: Hi')
  })

  test("in a group the sender's first name leads; one-to-one it doesn't", () => {
    const lm = { body: 'On it', sender: { id: 'u-eli', name: 'Eli Employee' } }
    expect(previewLine({ is_group: true, participants: [self, eli, ana], last_message: lm }, me)).toBe('Eli: On it')
    expect(previewLine({ participants: [self, eli], last_message: lm }, me)).toBe('On it')
  })

  test('no messages yet', () => {
    expect(previewLine({ participants: [self, eli], last_message: null }, me)).toBe('No messages yet')
  })
})

describe('read receipts', () => {
  const message = { id: 'm1', created_at: '2026-10-14T09:00:00Z', sender: { id: 'u-me' } }

  test('seen once every other participant has read up to it', () => {
    const conv = { participants: [self, { ...eli, last_read_at: '2026-10-14T09:00:00Z' }] }
    expect(isSeen(conv, me, message)).toBe(true)
  })

  test('not seen while anyone else is behind or has never opened it', () => {
    expect(isSeen({ participants: [self, eli] }, me, message)).toBe(false)
    const behind = { participants: [self, { ...eli, last_read_at: '2026-10-14T10:00:00Z' }, { ...ana, last_read_at: '2026-10-14T08:59:59Z' }] }
    expect(isSeen(behind, me, message)).toBe(false)
  })

  test('only my own messages get a receipt', () => {
    const conv = { participants: [self, { ...eli, last_read_at: '2026-10-14T11:00:00Z' }] }
    expect(isSeen(conv, me, { ...message, sender: { id: 'u-eli' } })).toBe(false)
  })
})

describe('finding an existing one-to-one', () => {
  test('matches the conversation with exactly that person', () => {
    const one = { id: 'c1', is_group: false, participants: [self, eli] }
    const group = { id: 'c2', is_group: true, participants: [self, eli, ana] }
    expect(directWith([group, one], me, 'u-eli')).toBe(one)
    expect(directWith([group], me, 'u-eli')).toBeUndefined()
  })
})

describe('day separators and bubble groups', () => {
  const now = new Date('2026-10-14T15:00:00')

  test('today, yesterday, then the weekday and date', () => {
    expect(dayLabel('2026-10-14T09:00:00', now)).toBe('Today')
    expect(dayLabel('2026-10-13T23:00:00', now)).toBe('Yesterday')
    expect(dayLabel('2026-10-09T10:00:00', now)).toBe('Fri 9 Oct')
  })

  test('consecutive messages from one person within five minutes share a group, split by day', () => {
    const at = (t) => `2026-10-14T${t}:00`
    const msgs = [
      { id: 'a', created_at: '2026-10-13T16:00:00', sender: { id: 'x' } },
      { id: 'b', created_at: at('09:00'), sender: { id: 'x' } },
      { id: 'c', created_at: at('09:03'), sender: { id: 'x' } },
      { id: 'd', created_at: at('09:20'), sender: { id: 'x' } },
      { id: 'e', created_at: at('09:21'), sender: { id: 'y' } },
    ]
    const groups = bubbleGroups(msgs, now)
    expect(groups.map((g) => [g.day, g.messages.map((m) => m.id).join('')])).toEqual([
      ['Yesterday', 'a'], ['Today', 'bc'], [null, 'd'], [null, 'e'],
    ])
  })
})

describe('composer', () => {
  test('Enter sends; Shift+Enter and IME composition do not', () => {
    expect(shouldSendOnKey({ key: 'Enter' })).toBe(true)
    expect(shouldSendOnKey({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(shouldSendOnKey({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(false)
    expect(shouldSendOnKey({ key: 'a' })).toBe(false)
  })

  test('the counter appears near the limit and says how far over', () => {
    expect(BODY_LIMIT).toBe(2000)
    expect(counterText('x'.repeat(1700))).toBeNull()
    expect(counterText('x'.repeat(1900))).toBe('100 left')
    expect(counterText('x'.repeat(2003))).toBe('3 over the limit')
    expect(counterText(`  ${'x'.repeat(1999)}  `)).toBe('1 left') // trimmed, like the server
  })
})

describe('merging pages of a thread', () => {
  test('each message once, oldest first, whichever page it came from', () => {
    const a = { id: 'a', created_at: '2026-10-14T09:00:00Z' }
    const b = { id: 'b', created_at: '2026-10-14T09:01:00Z' }
    const c = { id: 'c', created_at: '2026-10-14T09:02:00Z' }
    expect(mergeMessages([b, c], [a, b]).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
})
