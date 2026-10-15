// How audit entries read on the timeline: an icon and colour per kind of action, day headings, the sentence,
// and each changed field as "Status: In progress → Completed". Pure, so it's unit tested.
import Add from '@mui/icons-material/AddCircleOutlined'
import Block from '@mui/icons-material/Block'
import CheckCircle from '@mui/icons-material/CheckCircleOutlined'
import Edit from '@mui/icons-material/EditOutlined'
import Flag from '@mui/icons-material/FlagOutlined'
import GroupAdd from '@mui/icons-material/GroupAddOutlined'
import Inventory from '@mui/icons-material/Inventory2Outlined'
import Key from '@mui/icons-material/KeyOutlined'
import Login from '@mui/icons-material/Login'
import Note from '@mui/icons-material/StickyNote2Outlined'
import Photo from '@mui/icons-material/AccountCircleOutlined'
import Restore from '@mui/icons-material/RestoreOutlined'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import SwapHoriz from '@mui/icons-material/SwapHoriz'
import TaskAlt from '@mui/icons-material/TaskAlt'
import Hub from '@mui/icons-material/HubOutlined'
import HandRaised from '@mui/icons-material/BackHandOutlined'
import { STATUS } from '../../app/theme.js'

/** colour: a theme palette name, so both themes pick their own shade. */
const LOOK = {
  create: { Icon: Add, color: 'success' },
  create_from_request: { Icon: Add, color: 'success' },
  apply_template: { Icon: Add, color: 'success' },
  curate_demo_plan: { Icon: Hub, color: 'secondary' },
  update: { Icon: Edit, color: 'info' },
  edit: { Icon: Edit, color: 'info' },
  update_member: { Icon: Edit, color: 'info' },
  archive: { Icon: Inventory, color: 'warning' },
  remove_member: { Icon: Inventory, color: 'warning' },
  delete_draft: { Icon: Inventory, color: 'warning' },
  restore: { Icon: Restore, color: 'secondary' },
  approve: { Icon: CheckCircle, color: 'success' },
  complete: { Icon: TaskAlt, color: 'success' },
  reject: { Icon: Block, color: 'error' },
  claim: { Icon: HandRaised, color: 'primary' },
  auto_assign_support: { Icon: HandRaised, color: 'primary' },
  status_change: { Icon: SwapHoriz, color: 'primary' },
  log: { Icon: Schedule, color: 'primary' },
  add_member: { Icon: GroupAdd, color: 'success' },
  set_assignees: { Icon: GroupAdd, color: 'primary' },
  set_dependencies: { Icon: Hub, color: 'primary' },
  add_note: { Icon: Note, color: 'secondary' },
  login: { Icon: Login, color: 'secondary' },
  password_change: { Icon: Key, color: 'secondary' },
  password_reset: { Icon: Key, color: 'secondary' },
  password_reset_by_admin: { Icon: Key, color: 'warning' },
  avatar_set: { Icon: Photo, color: 'secondary' },
  avatar_remove: { Icon: Photo, color: 'secondary' },
}
const FALLBACK = { Icon: Flag, color: 'primary' }

/** The icon and colour for an entry; a milestone moved to Completed gets the completion look. */
export function lookFor(entry) {
  if (entry?.action === 'status_change' && entry?.changes?.after?.status === 'completed') return LOOK.complete
  return LOOK[entry?.action] ?? FALLBACK
}

export const humanize = (s) => String(s ?? '').replace(/_/g, ' ')
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** "Today", "Yesterday" or "Mon, Oct 12, 2026", in the viewer's time zone. */
export function dayLabel(iso, now = new Date()) {
  const date = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(date) === dayKey(now)) return 'Today'
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** Entries (newest first) grouped into days: [{key, label, items}]. */
export function groupByDay(items, now = new Date()) {
  const groups = []
  for (const item of items) {
    const key = dayKey(new Date(item.created_at))
    if (groups.at(-1)?.key !== key) groups.push({ key, label: dayLabel(item.created_at, now), items: [] })
    groups.at(-1).items.push(item)
  }
  return groups
}

/** A recorded value as people read it: statuses by their label, lists joined, nothing as an em dash. */
export function showValue(value, field) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map((v) => showValue(v)).join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  if (field === 'status') return STATUS[value]?.label ?? capitalize(humanize(value))
  return String(value)
}

/** One {field, from, to} per field whose value differs; `from` is null on a create (there was no before).
 *  A field missing on both sides (say a salary kept from an executive) never shows. */
export function changedFields(changes) {
  const before = changes?.before ?? null
  const after = changes?.after ?? null
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  return keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null))
    .map((k) => ({ field: capitalize(humanize(k)), from: before ? showValue(before[k], k) : null, to: showValue(after?.[k], k) }))
}

/** The entry as a sentence. The server's summary when present ("Morgan Manager approved 9h for Eli Employee on
 *  Schema Mapping"), else built from the action and record type. */
export function sentenceFor(entry) {
  if (entry?.summary?.sentence) return entry.summary.sentence
  return `${entry?.actor?.name ?? 'System'} ${humanize(entry?.action)} ${humanize(entry?.entity_type)}`.trim()
}

/** The part of the sentence after the actor's name, so the name can be shown (and linked) on its own. */
export function predicateFor(entry) {
  const sentence = sentenceFor(entry)
  const name = entry?.summary?.actor?.name ?? entry?.actor?.name ?? 'System'
  return sentence.startsWith(name) ? sentence.slice(name.length).trim() : sentence
}
