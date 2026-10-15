// The delivery report as email-safe HTML: tables and inline styles only (email clients drop <style>, scripts and
// most CSS), no images. Every name and number from the data is escaped, so a project called "<b>Apollo</b>" arrives
// as text and can't inject markup into the email. Pure, so it's unit tested.
import { formatDate, formatMoney, formatPct } from '../../lib/format.js'
import { RISK_LABELS } from '../../lib/labels.js'

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])

const INK = '#1F2933'
const MUTED = '#5B6B7F'
const LINE = '#E3E8EF'
const RED = '#B3261E'
const FONT = "font-family:Segoe UI,Helvetica,Arial,sans-serif;"
const cell = `padding:8px 10px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};${FONT}`
const head = `padding:8px 10px;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em;text-align:left;${FONT}`
const num = 'text-align:right;white-space:nowrap;'

const heading = (text) =>
  `<h2 style="margin:28px 0 10px;font-size:17px;color:${INK};${FONT}">${escapeHtml(text)}</h2>`

const table = (headers, rows, numeric = []) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">`
  + `<tr>${headers.map((h, i) => `<th style="${head}${numeric.includes(i) ? num : ''}">${escapeHtml(h)}</th>`).join('')}</tr>`
  + rows.map((r) => `<tr>${r.map((v, i) => `<td style="${cell}${numeric.includes(i) ? num : ''}">${v}</td>`).join('')}</tr>`).join('')
  + '</table>'

/** "Oct 14, 2026" for the viewer's local day. */
export const reportDate = (date = new Date()) =>
  formatDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)

export const reportSubject = (date = new Date()) => `Scout delivery report — ${reportDate(date)}`

const none = (text) => `<p style="margin:0;font-size:14px;color:${MUTED};${FONT}">${escapeHtml(text)}</p>`

/** Headline numbers: at-risk projects, overdue milestones, pending approvals, budget used across projects. */
export function headline(dashboard) {
  const budgets = dashboard?.budgets ?? []
  const budget = budgets.reduce((sum, b) => sum + Number(b.budget ?? 0), 0)
  const consumed = budgets.reduce((sum, b) => sum + Number(b.consumed ?? 0), 0)
  return {
    atRisk: dashboard?.at_risk?.length ?? 0,
    overdue: dashboard?.milestones?.overdue?.length ?? 0,
    pendingApprovals: dashboard?.pending_approvals ?? 0,
    budget, consumed, budgetPct: budget > 0 ? (consumed / budget) * 100 : 0,
  }
}

function kpiTiles(k) {
  const tiles = [
    ['At-risk projects', String(k.atRisk), k.atRisk > 0],
    ['Overdue milestones', String(k.overdue), k.overdue > 0],
    ['Pending approvals', String(k.pendingApprovals), false],
    ['Budget used', formatPct(k.budgetPct), k.budgetPct > 100],
  ]
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;width:100%;"><tr>`
    + tiles.map(([label, value, alert]) => `<td width="25%" style="padding:12px;border:1px solid ${LINE};border-radius:8px;${FONT}vertical-align:top;">`
      + `<div style="font-size:12px;color:${MUTED};">${escapeHtml(label)}</div>`
      + `<div style="font-size:24px;font-weight:700;color:${alert ? RED : INK};margin-top:4px;">${escapeHtml(value)}</div></td>`).join('')
    + '</tr></table>'
    + `<p style="margin:8px 8px 0;font-size:13px;color:${MUTED};${FONT}">${escapeHtml(formatMoney(k.consumed))} of ${escapeHtml(formatMoney(k.budget))} consumed across all projects in this report.</p>`
}

/**
 * dashboard: the /dashboard payload the viewer is looking at (already narrowed to the department filter);
 * insights: the smart insights list; scope: the department name or "All departments"; preparedBy: the sender's name.
 */
export function buildReportHtml({ dashboard, insights = [], scope = 'All departments', preparedBy = '', date = new Date() }) {
  const k = headline(dashboard)
  const atRisk = dashboard?.at_risk ?? []
  const budgets = dashboard?.budgets ?? []
  const today = reportDate(date)
  const parts = []
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:680px;margin:0 auto;"><tr><td style="padding:24px;${FONT}color:${INK};">`)
  parts.push(`<div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">ACME Scout</div>`)
  parts.push(`<h1 style="margin:4px 0 4px;font-size:22px;color:${INK};${FONT}">Delivery report</h1>`)
  parts.push(`<p style="margin:0;font-size:14px;color:${MUTED};${FONT}">${escapeHtml(today)} · ${escapeHtml(scope)}${preparedBy ? ` · prepared by ${escapeHtml(preparedBy)}` : ''}</p>`)

  parts.push(heading('Headline'))
  parts.push(kpiTiles(k))

  parts.push(heading(`At-risk projects (${atRisk.length})`))
  parts.push(atRisk.length
    ? table(['Project', 'Why'], atRisk.map((p) => [`<strong>${escapeHtml(p.name)}</strong>`,
      escapeHtml((p.reasons ?? []).map((r) => RISK_LABELS[r] ?? r).join(', '))]))
    : none('Nothing is at risk. Every project is on track.'))

  const top = insights.slice(0, 5)
  parts.push(heading('Top insights'))
  parts.push(top.length
    ? table(['Insight', 'Detail'], top.map((i) => [`<strong>${escapeHtml(i.title)}</strong>`
      + (i.severity ? `<div style="font-size:12px;color:${i.severity === 'high' ? RED : MUTED};">${escapeHtml(i.severity)} priority</div>` : ''),
    escapeHtml(i.detail)]))
    : none('No suggestions right now.'))

  parts.push(heading('Budget by project'))
  parts.push(budgets.length
    ? table(['Project', 'Budget', 'Consumed', '% used', 'Forecast'], budgets.map((b) => {
      const pct = Number(b.budget) > 0 ? (Number(b.consumed) / Number(b.budget)) * 100 : 0
      const over = Number(b.budget) > 0 && Number(b.forecast) > Number(b.budget)
      return [escapeHtml(b.name), escapeHtml(formatMoney(b.budget)), escapeHtml(formatMoney(b.consumed)), escapeHtml(formatPct(pct)),
        `<span style="color:${over ? RED : INK};${over ? 'font-weight:700;' : ''}">${escapeHtml(formatMoney(b.forecast))}${over ? ' (over budget)' : ''}</span>`]
    }), [1, 2, 3, 4])
    : none('No budgets yet.'))

  parts.push(`<p style="margin:28px 0 0;font-size:12px;color:${MUTED};${FONT}">Sent from ACME Scout. Figures are as of the moment this report was sent; consumed counts approved hours.</p>`)
  parts.push('</td></tr></table>')
  return parts.join('')
}
