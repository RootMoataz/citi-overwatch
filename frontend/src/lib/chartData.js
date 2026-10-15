// Shaping and formatting for the charts: pure, so the sorting and the thresholds are unit tested.
import { toneFor } from '../app/chartColors.js'

export const WEEKLY_CAP = 40
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** $250,000 → "$250K", $1,250,000 → "$1.3M", for axis ticks and tight labels. */
export const compactMoney = (value) => `${Number(value) < 0 ? '-' : ''}$${compact.format(Math.abs(Number(value ?? 0)))}`

/** value as a % of `of` (0 when there's nothing to divide by). */
export const pctOf = (value, of) => (Number(of) > 0 ? (Number(value ?? 0) / Number(of)) * 100 : 0)

/** The smallest multiple of `step` at or above `value` (at least one step), for an axis maximum. */
export const niceMax = (value, step) => Math.max(step, Math.ceil(Number(value || 0) / step) * step)

/** 0, step, 2·step … max. */
export const ticksTo = (max, step) => Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)

/** One bullet row per project: consumed as a % of its budget, the forecast as a marker, most used first.
 *  Spent past the budget is alert; a forecast past it is a warning. Projects without a budget go last. */
export function budgetRows(budgets) {
  return budgets.map((b) => {
    const budget = Number(b.budget)
    const consumed = Number(b.consumed)
    const forecast = Number(b.forecast ?? consumed)
    const hasBudget = budget > 0
    const usedPct = pctOf(consumed, budget)
    const forecastPct = pctOf(forecast, budget)
    const tone = !hasBudget ? 'ok' : usedPct > 100 ? 'alert' : forecastPct > 100 ? 'warning' : 'ok'
    return { id: String(b.project_id ?? b.id), name: b.name, budget, consumed, forecast, hasBudget, usedPct, forecastPct, tone }
  }).sort((a, b) => Number(b.hasBudget) - Number(a.hasBudget) || b.usedPct - a.usedPct || a.name.localeCompare(b.name))
}

/** People for the allocation chart, busiest first: logged hours, planned as the ghost, over 40h flagged. */
export function allocationRows(people) {
  return people.map((p) => {
    const logged = Number(p.logged_total)
    return { id: String(p.user.id), user: p.user, name: p.user.name, logged, planned: Number(p.planned_total),
      over: logged > WEEKLY_CAP, tone: logged > WEEKLY_CAP ? 'alert' : 'ok' }
  }).sort((a, b) => b.logged - a.logged || b.planned - a.planned || a.name.localeCompare(b.name))
}

/** Logged hours per project this week, largest first. Hours on projects someone has left fall under "Other projects". */
export function hoursByProject(people) {
  const byProject = new Map()
  let other = 0
  for (const person of people) {
    let counted = 0
    for (const p of person.projects) {
      const logged = Number(p.logged)
      counted += logged
      if (logged > 0) byProject.set(String(p.id), { label: p.name, value: (byProject.get(String(p.id))?.value ?? 0) + logged })
    }
    other += Math.max(Number(person.logged_total) - counted, 0)
  }
  const data = [...byProject.entries()].map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
  if (other > 0) data.push({ id: 'other', label: 'Other projects', value: other })
  return data
}

/** A donut reads only with a handful of slices; past five, bars compare better. */
export const MAX_DONUT_SLICES = 5
export const hoursForm = (slices) => (slices.length <= MAX_DONUT_SLICES ? 'donut' : 'bars')

/** Utilization's tone: over 100% of the 40h week is alert. */
export const utilizationTone = (pct) => toneFor(pct)

/** Budget used's tone in tables: over 100% alert, from 90% a warning. */
export const budgetTone = (pct) => toneFor(pct, { warnAt: 90 })
