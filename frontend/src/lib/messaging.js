// Plain helpers for Messages: titles, previews, read receipts, day separators and the composer's keys and counter.
// The server decides who may message whom (backend app/rules/messaging.py); the screen asks it through
// /messages/contacts instead of guessing.

/** What the server says when an employee writes to an admin, an executive or a manager who isn't theirs. */
export const EMPLOYEE_NOT_ALLOWED = 'Employees can message their manager, their project managers and other employees.'
/** The compose dialog's reminder for employees of who they can write to. */
export const EMPLOYEE_HINT = 'You can message your manager, your project managers and other employees.'
/** The server's limit on a message, after trimming. */
export const BODY_LIMIT = 2000
/** Show the character counter once a message gets this close to the limit. */
const COUNTER_FROM = 200

const same = (a, b) => a != null && b != null && String(a) === String(b)
const firstName = (name) => String(name ?? '').split(' ')[0]

/** Whether the viewer may start a conversation with `person`: never themselves, otherwise only someone on the
 * server's contact list (/messages/contacts). For an employee that is their manager, their project managers and
 * delegate approvers, and every other active employee; for everyone else, any active person. */
export function canMessage(contacts, person, me) {
  if (!person?.id || same(person.id, me?.id)) return false
  return (contacts?.items ?? []).some((c) => same(c.id, person.id))
}

/** Everyone in the conversation except the viewer. */
export const others = (conversation, me) => (conversation?.participants ?? []).filter((p) => !same(p.id, me?.id))

/** A group's subject, else the other people's names (one-to-one: just the other person). */
export function conversationTitle(conversation, me) {
  if (conversation?.is_group && conversation.subject) return conversation.subject
  const names = others(conversation, me).map((p) => p.name)
  return names.length ? names.join(', ') : 'Just you'
}

/** The list's second line: "You: …" for my own message, "Ana: …" in a group, otherwise the text itself. */
export function previewLine(conversation, me) {
  const last = conversation?.last_message
  if (!last) return 'No messages yet'
  if (same(last.sender?.id, me?.id)) return `You: ${last.body}`
  return conversation.is_group ? `${firstName(last.sender?.name)}: ${last.body}` : last.body
}

/** My message counts as seen once every other participant has read up to it. */
export function isSeen(conversation, me, message) {
  if (!message || !same(message.sender?.id, me?.id)) return false
  const rest = others(conversation, me)
  const sent = new Date(message.created_at).getTime()
  return rest.length > 0 && rest.every((p) => p.last_read_at && new Date(p.last_read_at).getTime() >= sent)
}

/** The existing one-to-one conversation with `personId`, if there is one. */
export function directWith(conversations, me, personId) {
  return (conversations ?? []).find((c) => !c.is_group && !c.milestone
    && others(c, me).length === 1 && same(others(c, me)[0].id, personId))
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** "Today", "Yesterday", else "Fri 9 Oct". */
export function dayLabel(iso, now = new Date()) {
  const then = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const weekday = then.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${weekday} ${then.getDate()} ${then.toLocaleDateString('en-GB', { month: 'short' })}`
}

const GROUP_GAP_MS = 5 * 60 * 1000

/** Messages (oldest first) as bubble groups: one sender, no more than five minutes apart, within one day.
 * A group that starts a new day carries that day's label in `day`. */
export function bubbleGroups(messages, now = new Date()) {
  const groups = []
  let lastDay = null
  for (const m of messages ?? []) {
    const day = startOfDay(new Date(m.created_at))
    const prev = groups[groups.length - 1]
    const tail = prev?.messages[prev.messages.length - 1]
    const joins = prev && day === lastDay && same(tail.sender?.id, m.sender?.id)
      && new Date(m.created_at) - new Date(tail.created_at) <= GROUP_GAP_MS
    if (joins) {
      prev.messages.push(m)
    } else {
      groups.push({ key: m.id, sender: m.sender, day: day === lastDay ? null : dayLabel(m.created_at, now), messages: [m] })
    }
    lastDay = day
  }
  return groups
}

/** Enter sends; Shift+Enter makes a new line; nothing fires while an input method is composing text. */
export function shouldSendOnKey(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing
}

/** "120 left" near the limit, "3 over the limit" past it, otherwise nothing. */
export function counterText(text) {
  const length = String(text ?? '').trim().length
  const left = BODY_LIMIT - length
  if (left < 0) return `${-left} over the limit`
  return left <= COUNTER_FROM ? `${left} left` : null
}

/** "10:42" for a message's time. */
export const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
