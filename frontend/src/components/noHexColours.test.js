import { describe, expect, test } from 'vitest'

const own = import.meta.glob(['./SidePanel.jsx', './KpiStrip.jsx', './FilterBar.jsx', './DataTable.jsx', './FootNote.jsx'],
  { query: '?raw', import: 'default', eager: true })
const sources = {
  ...own,
  ...import.meta.glob('../features/projects/*.jsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../features/milestones/**/*.jsx', { query: '?raw', import: 'default', eager: true }),
}

describe('colours come from the theme', () => {
  test('the five shared components are scanned', () => {
    expect(Object.keys(own)).toHaveLength(5)
  })
  test.each(Object.entries(sources))('%s has no hex colours', (_path, text) => {
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
