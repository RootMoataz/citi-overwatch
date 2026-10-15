// Puppy's safeguards. Puppy only reads what the signed-in person already gets from Scout's normal, role-scoped
// endpoints (the server's checks stay the final guard), and before anything reaches Puppy's rules it is cut down to an
// allow-list of harmless fields here. redact() is the safety net for anything else: it drops pay, rates, costs,
// passwords, codes, contact details, message bodies and audit changes at any depth, and redactText() masks email
// addresses, one-time codes and passwords inside free text (server messages, insight details).

export const SENSITIVE_KEYS = ['salary', 'hourly_rate', 'rate', 'cost', 'cost_per_person', 'temp_password', 'temporary_password',
  'password', 'code', 'reset_code', 'token', 'email', 'phone', 'body', 'changes', 'note', 'subject']

const SENSITIVE = new Set(SENSITIVE_KEYS)
const HIDDEN = '[hidden]'

/** A copy of `value` without any sensitive key, however deep. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([k]) => !SENSITIVE.has(k.toLowerCase())).map(([k, v]) => [k, redact(v)]))
}

/** Free text with email addresses, passwords, codes and long digit runs masked. */
export function redactText(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/[^\s@,;:()<>]+@[^\s@,;:()<>]+\.[^\s@,;:()<>]+/g, HIDDEN)
    .replace(/\b(password|passcode)(\s*[:=]?\s*)\S+/gi, `$1$2${HIDDEN}`)
    .replace(/\b(code|pin)(\s*[:=]?\s*)\S*\d\S*/gi, `$1$2${HIDDEN}`)
    .replace(/\b\d{6,}\b/g, HIDDEN)
}

const ref = (x) => (x && typeof x === 'object' ? { id: x.id ?? null, name: redactText(x.name ?? '') } : null)
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]))

/** A notification as Puppy may use it: what it is, when, who it's about (name only) and where it leads. */
export function pickNotification(n) {
  const p = n?.payload ?? {}
  return {
    id: n?.id, type: n?.type, week_start: n?.week_start ?? null, created_at: n?.created_at ?? null,
    message: redactText(n?.message ?? ''),
    subject_user: ref(n?.subject_user),
    payload: {
      ...pick(p, ['conversation_id', 'week_start', 'until', 'end_date', 'is_group']),
      ...(p.name ? { name: redactText(String(p.name)) } : {}),
      ...(p.project ? { project: ref(p.project) } : {}),
      ...(p.milestone ? { milestone: ref(p.milestone) } : {}),
      ...(p.manager ? { manager: ref(p.manager) } : {}),
    },
  }
}

export const pickInsight = (i) => ({ id: i?.id, severity: i?.severity, title: redactText(i?.title ?? ''),
  detail: redactText(i?.detail ?? ''), link: pick(i?.link ?? {}, ['to', 'id', 'tab']) })

// flagged: only whether the server raised a red flag on it (no flag text, note or hours), for "N entries have red flags".
export const pickApproval = (a) => ({ entry: { id: a?.entry?.id, work_date: a?.entry?.work_date }, user: { id: a?.user?.id },
  flagged: Array.isArray(a?.flags) && a.flags.length > 0 })

export const pickProject = (p) => ({ id: p?.id, name: redactText(p?.name ?? ''), status: p?.status,
  at_risk_reasons: Array.isArray(p?.at_risk_reasons) ? p.at_risk_reasons.filter((r) => typeof r === 'string') : [] })

export const pickMilestone = (m) => ({ id: m?.id, name: redactText(m?.name ?? ''), project_id: m?.project_id,
  priority: m?.priority, status: m?.status, end_date: m?.end_date })

/** A person for name matching in Ask Puppy: names, id and how the viewer relates to them (for canViewProfile). */
export const pickPerson = (p) => ({ id: p?.id, name: redactText(p?.name ?? ''), first_name: p?.first_name,
  last_name: p?.last_name, context: p?.context ? pick(p.context, ['managed']) : undefined })

/** Everything Puppy reads, allow-listed. Missing parts stay missing (undefined / empty), never an error. */
export function puppyView({ notifications, insights, approvals, missing, projects, milestones, contacts, people,
  departments } = {}) {
  return {
    people: (people ?? []).map(pickPerson),
    departments: (departments ?? []).map(ref),
    notifications: (notifications ?? []).map(pickNotification),
    insights: (insights ?? []).map(pickInsight),
    approvals: (approvals ?? []).map(pickApproval),
    missing: missing ? { week_start: missing.week_start, people: (missing.people ?? []).map((p) => ({ id: p?.id })) } : null,
    projects: (projects ?? []).map(pickProject),
    milestones: (milestones ?? []).map(pickMilestone),
    contacts: (contacts ?? []).map((c) => ({ ...ref(c), relation: typeof c?.relation === 'string' ? redactText(c.relation) : null })),
  }
}
