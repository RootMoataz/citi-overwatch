import { describe, expect, test } from 'vitest'
import { chartPalette, toneFor } from '../app/chartColors.js'
import {
  allocationRows, budgetRows, budgetTone, compactMoney, hoursByProject, hoursForm, niceMax, pctOf, ticksTo, utilizationTone,
} from './chartData.js'

describe('formatting', () => {
  test('compact money for axis ticks', () => {
    expect(compactMoney(0)).toBe('$0')
    expect(compactMoney(50000)).toBe('$50K')
    expect(compactMoney(250000)).toBe('$250K')
    expect(compactMoney(1250000)).toBe('$1.3M')
    expect(compactMoney(-1500)).toBe('-$1.5K')
  })

  test('percent of, with nothing to divide by', () => {
    expect(pctOf(25, 100)).toBe(25)
    expect(pctOf(5, 0)).toBe(0)
  })

  test('axis maximum and ticks', () => {
    expect(niceMax(45, 10)).toBe(50)
    expect(niceMax(40, 10)).toBe(40)
    expect(niceMax(0, 25)).toBe(25)
    expect(ticksTo(100, 25)).toEqual([0, 25, 50, 75, 100])
  })
})

describe('tones', () => {
  test('over 100% is alert; a warning threshold turns it amber first', () => {
    expect(toneFor(100)).toBe('ok')
    expect(toneFor(100.1)).toBe('alert')
    expect(budgetTone(89)).toBe('ok')
    expect(budgetTone(90)).toBe('warning')
    expect(budgetTone(130)).toBe('alert')
    expect(utilizationTone(112.5)).toBe('alert')
    expect(utilizationTone(95)).toBe('ok')
  })

  test('light and dark palettes have the same roles and eight series colours', () => {
    const light = chartPalette('light')
    const dark = chartPalette({ palette: { mode: 'dark' } })
    expect(Object.keys(dark)).toEqual(Object.keys(light))
    expect(light.series).toHaveLength(8)
    expect(new Set(dark.series).size).toBe(8)
    expect(light.alert).not.toBe(dark.alert)
  })
})

describe('budget rows', () => {
  const budgets = [
    { project_id: 'p1', name: 'Apollo', budget: 250000, consumed: 50000, forecast: 120000 },
    { project_id: 'p2', name: 'Atlas', budget: 60000, consumed: 58000, forecast: 70000 },
    { project_id: 'p3', name: 'Zeus', budget: 0, consumed: 1000, forecast: 2000 },
    { project_id: 'p4', name: 'Hermes', budget: '10000.00', consumed: '12000.00', forecast: '15000.00' },
  ]

  test('sorted by share used, projects without a budget last', () => {
    expect(budgetRows(budgets).map((r) => r.name)).toEqual(['Hermes', 'Atlas', 'Apollo', 'Zeus'])
  })

  test('spent past the budget is alert, a forecast past it a warning, otherwise ok', () => {
    const byName = Object.fromEntries(budgetRows(budgets).map((r) => [r.name, r]))
    expect(byName.Hermes).toMatchObject({ tone: 'alert', usedPct: 120, forecastPct: 150 })
    expect(byName.Atlas.tone).toBe('warning')
    expect(byName.Apollo).toMatchObject({ tone: 'ok', usedPct: 20, forecastPct: 48 })
    expect(byName.Zeus).toMatchObject({ hasBudget: false, tone: 'ok', usedPct: 0 })
  })
})

describe('allocation', () => {
  const person = (id, name, planned, logged, projects = []) => ({ user: { id, name }, planned_total: planned, logged_total: logged, projects })

  test('busiest first, over 40h flagged', () => {
    const rows = allocationRows([person('a', 'Ada', 20, 12), person('e', 'Eli', 30, 45), person('b', 'Bo', 10, 12),
      person('c', 'Cy', 0, 0)])
    expect(rows.map((r) => r.name)).toEqual(['Eli', 'Ada', 'Bo', 'Cy'])
    expect(rows[0]).toMatchObject({ over: true, tone: 'alert', logged: 45, planned: 30 })
    expect(rows[1]).toMatchObject({ over: false, tone: 'ok' })
  })

  test('hours by project add up across people, largest first, with hours on left projects as Other', () => {
    const data = hoursByProject([
      person('e', 'Eli', 40, 45, [{ id: 'p1', name: 'Apollo', logged: 30 }, { id: 'p2', name: 'Atlas', logged: 10 }]),
      person('a', 'Ada', 20, 12, [{ id: 'p2', name: 'Atlas', logged: 12 }, { id: 'p3', name: 'Zeus', logged: 0 }]),
    ])
    expect(data).toEqual([{ id: 'p1', label: 'Apollo', value: 30 }, { id: 'p2', label: 'Atlas', value: 22 },
      { id: 'other', label: 'Other projects', value: 5 }])
  })

  test('a donut for five slices or fewer, bars past that', () => {
    const slices = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), label: String(i), value: 1 }))
    expect(hoursForm(slices(5))).toBe('donut')
    expect(hoursForm(slices(6))).toBe('bars')
  })
})
