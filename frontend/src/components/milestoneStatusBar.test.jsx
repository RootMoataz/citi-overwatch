import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderWithProviders } from '../test/render.jsx'
import MilestoneStatusBar from './MilestoneStatusBar.jsx'

const ms = (id, display_status, overrides) => ({ id, name: `M${id}`, display_status, status: display_status, is_archived: false, ...overrides })
const items = [
  ms(1, 'blocked'), ms(2, 'completed'), ms(3, 'in_progress'), ms(4, 'completed'), ms(5, 'completed'),
  ms(6, 'in_progress'), ms(7, 'waiting'),
]

describe('MilestoneStatusBar', () => {
  test('heading counts the completed milestones', () => {
    renderWithProviders(<MilestoneStatusBar items={items} />)
    const section = screen.getByRole('region', { name: '3 of 7 milestones done' })
    expect(within(section).getByRole('heading', { name: '3 of 7 milestones done' })).toBeInTheDocument()
  })

  test('one segment per state present, in the fixed order, sized by count', () => {
    renderWithProviders(<MilestoneStatusBar items={items} />)
    const segments = screen.getAllByRole('img')
    expect(segments.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Completed: 3 milestones', 'In progress: 2 milestones', 'Waiting on dependencies: 1 milestone', 'Blocked – needs review: 1 milestone',
    ])
    expect(segments.map((s) => s.getAttribute('data-count'))).toEqual(['3', '2', '1', '1'])
    expect(segments[0]).toHaveStyle({ width: `${(3 / 7) * 100}%` })
    expect(segments[1]).toHaveStyle({ width: `${(2 / 7) * 100}%` })
    const legend = screen.getByRole('list', { name: 'Milestones by state' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Completed 3', 'In progress 2', 'Waiting on dependencies 1', 'Blocked – needs review 1',
    ])
  })

  test('archived milestones are left out', () => {
    renderWithProviders(<MilestoneStatusBar items={[ms(1, 'completed'), ms(2, 'in_progress', { is_archived: true })]} />)
    expect(screen.getByRole('heading', { name: '1 of 1 milestones done' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.queryByText(/In progress/)).not.toBeInTheDocument()
  })

  test('nothing renders without milestones', () => {
    const { container } = renderWithProviders(<MilestoneStatusBar items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('nothing renders when every milestone is archived', () => {
    const { container } = renderWithProviders(<MilestoneStatusBar items={[ms(1, 'completed', { is_archived: true })]} />)
    expect(container).toBeEmptyDOMElement()
  })

  describe('counts inside the segments', () => {
    // The milestones arrive after the bar has mounted, as they do on the Milestones tab.
    function Late({ list }) {
      const [loaded, setLoaded] = useState(false)
      return (
        <>
          <button onClick={() => setLoaded(true)}>load</button>
          <MilestoneStatusBar items={loaded ? list : []} />
        </>
      )
    }
    const observers = []
    class FakeObserver {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe() {}
      disconnect() {}
    }
    afterEach(() => { vi.unstubAllGlobals(); observers.length = 0 })

    test('are printed once the bar is measured, at 24px and up, even when the bar appears after mount', async () => {
      // One quarter of the bar is completed, three quarters in progress; two segments share one 2px gap.
      vi.stubGlobal('ResizeObserver', FakeObserver)
      const list = [ms(1, 'completed'), ms(2, 'in_progress'), ms(3, 'in_progress'), ms(4, 'in_progress')]
      renderWithProviders(<Late list={list} />)
      await userEvent.click(screen.getByRole('button', { name: 'load' }))
      const measure = (width) => act(() => observers.forEach((o) => o.callback([{ contentRect: { width } }])))
      measure(97)
      const [done, doing] = screen.getAllByRole('img')
      expect(doing).toHaveTextContent('3') // 72px
      expect(done).toHaveTextContent('') // (97 - 2) / 4 = 23.75px
      measure(98) // 24px
      expect(done).toHaveTextContent('1')
    })
  })
})
