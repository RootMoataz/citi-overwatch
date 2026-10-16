// Expected time frame as people read it: "Est. 120h · 30 days (22 working days)" and "86h logged · 72% of estimate".
// Pure, so it's unit tested. The numbers come from the server (estimated_hours, duration_days, working_days,
// logged_hours, estimate_used_pct on milestones; total_estimated_hours and friends on projects).
import { formatHours, formatPct } from './format.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** ok up to 90% of the estimate, warning (amber) above 90%, alert (red) above 100%. */
export function estimateTone(pct) {
  if (pct == null) return 'ok'
  if (Number(pct) > 100) return 'alert'
  if (Number(pct) > 90) return 'warning'
  return 'ok'
}

/** The words that go with a tone, so colour is never the only signal. */
const TONE_WORDS = { ok: '', warning: ' · nearly used', alert: ' · over estimate' }

/** "Est. 120h · 30 days (22 working days)"; without an estimate just the days. */
export function timeFrameLine(m) {
  if (m?.duration_days == null) return ''
  const days = `${plural(m.duration_days, 'day')} (${plural(m.working_days, 'working day')})`
  return m.estimated_hours != null ? `Est. ${formatHours(m.estimated_hours)} · ${days}` : days
}

/** "86h logged · 72% of estimate" once anything is logged; null before that. */
export function usageLine(m) {
  if (!Number(m?.logged_hours)) return null
  const logged = `${formatHours(m.logged_hours)} logged`
  if (m.estimate_used_pct == null) return { text: logged, tone: 'ok' }
  const tone = estimateTone(m.estimate_used_pct)
  return { text: `${logged} · ${formatPct(Math.round(m.estimate_used_pct))} of estimate${TONE_WORDS[tone]}`, tone }
}

/** A milestone's Effort cell: "118h / 264h", "114h estimate" (nothing logged), "7.5h logged" (no estimate) or "—";
 * `over` is "+0.5h over estimate" once logged hours pass the estimate, otherwise null. */
export function effortText(m) {
  const logged = Number(m?.logged_hours) || 0
  const estimate = m?.estimated_hours == null ? null : Number(m.estimated_hours)
  if (estimate == null) return { text: logged ? `${formatHours(logged)} logged` : '—', over: null }
  if (!logged) return { text: `${formatHours(estimate)} estimate`, over: null }
  const extra = Math.round((logged - estimate) * 100) / 100   // hundredths, so 100.3 - 100.1 reads 0.2
  return { text: `${formatHours(logged)} / ${formatHours(estimate)}`, over: extra > 0 ? `+${formatHours(extra)} over estimate` : null }
}

/** The project tile: value "640h", hint "over 120 days · 52% used". */
export function projectEffort(p) {
  if (p?.total_estimated_hours == null) {
    return { value: '—', hint: p?.duration_days != null ? `No estimates yet · ${plural(p.duration_days, 'day')}` : '', tone: 'ok' }
  }
  const tone = estimateTone(p.estimate_used_pct)
  return { value: formatHours(p.total_estimated_hours),
    hint: `over ${plural(p.duration_days, 'day')} · ${formatPct(Math.round(p.estimate_used_pct ?? 0))} used${TONE_WORDS[tone]}`, tone }
}
