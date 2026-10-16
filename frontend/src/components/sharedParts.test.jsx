import { useState } from 'react'
import { Menu, MenuItem } from '@mui/material'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderWithProviders } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import DataTable from './DataTable.jsx'
import FilterBar from './FilterBar.jsx'
import FootNote from './FootNote.jsx'
import KpiStrip from './KpiStrip.jsx'
import SidePanel from './SidePanel.jsx'

function PanelHarness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false)
  return (
    <SidePanel open={open} title="Kickoff" onClose={() => { onClose(); setOpen(false) }}
      list={<button onClick={() => setOpen(true)}>Open it</button>}>
      <p>Panel body</p>
    </SidePanel>
  )
}

describe('SidePanel', () => {
  test('desktop: a complementary named by its title, focus on open, Esc closes, focus returns', async () => {
    const onClose = vi.fn()
    renderWithProviders(<PanelHarness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    opener.focus()
    await userEvent.click(opener)
    const panel = screen.getByRole('complementary', { name: 'Kickoff' })
    expect(within(panel).getByRole('heading', { level: 2, name: 'Kickoff' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  test('the Close button closes', async () => {
    const onClose = vi.fn()
    renderWithProviders(<SidePanel open title="T" onClose={onClose} list={<p>list</p>}>x</SidePanel>)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('returnFocus decides where focus lands after close', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <input aria-label="Elsewhere" />
          <SidePanel open={open} title="T" onClose={() => setOpen(false)}
            returnFocus={() => document.querySelector('input[aria-label="Elsewhere"]')} list={<p>list</p>}>x</SidePanel>
        </>
      )
    }
    renderWithProviders(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByLabelText('Elsewhere')).toHaveFocus()
  })

  test('375 px: a full-screen modal dialog with a Close button', () => {
    setViewport(375)
    renderWithProviders(<SidePanel open title="Kickoff" onClose={() => {}} list={<p>the list</p>}>Body</SidePanel>)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})

describe('KpiStrip', () => {
  const onClick = vi.fn()
  const items = [
    { key: 'a', label: 'projects', value: '6' },
    { key: 'b', label: 'active', value: '4' },
    { key: 'c', label: 'at risk', value: '2', tone: 'warning', onClick },
  ]
  test('renders labelled values and a clickable item as a button', async () => {
    renderWithProviders(<KpiStrip ariaLabel="Summary" items={items} />)
    const group = screen.getByRole('group', { name: 'Summary' })
    expect(within(group).getByText('projects')).toBeInTheDocument()
    expect(within(group).getByText('4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '2 at risk' }))
    expect(onClick).toHaveBeenCalled()
  })
  test('phoneColumns={3} keeps three columns at 375 px; the default is two', () => {
    setViewport(375)
    const { unmount } = renderWithProviders(<KpiStrip ariaLabel="Summary" items={items} phoneColumns={3} />)
    expect(screen.getByRole('group', { name: 'Summary' }).firstElementChild)
      .toHaveStyle({ gridTemplateColumns: 'repeat(3, 1fr)' })
    unmount()
    renderWithProviders(<KpiStrip ariaLabel="Summary" items={items} />)
    expect(screen.getByRole('group', { name: 'Summary' }).firstElementChild)
      .toHaveStyle({ gridTemplateColumns: 'repeat(2, 1fr)' })
  })
  test('a bar carries aria-valuetext; an error shows Retry', async () => {
    const onRetry = vi.fn()
    renderWithProviders(<KpiStrip ariaLabel="Money" items={[{ key: 'p', label: 'Progress', value: '40%',
      bar: { value: 40, label: 'Progress used', tone: 'ok' } }]} />)
    expect(screen.getByRole('progressbar', { name: 'Progress used' })).toHaveAttribute('aria-valuetext', '40%')
    renderWithProviders(<KpiStrip ariaLabel="Err" items={[]} error={new Error('boom')} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('FilterBar', () => {
  test('the search box is named by its label and shows the placeholder', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <FilterBar search={{ label: 'Search projects', placeholder: 'Search projects…', value: '', onChange }}
        end={<span>right</span>}><span>child</span></FilterBar>)
    const box = screen.getByRole('textbox', { name: 'Search projects' })
    expect(box).toHaveAttribute('placeholder', 'Search projects…')
    await userEvent.type(box, 'a')
    expect(onChange).toHaveBeenCalledWith('a')
    expect(screen.getByText('right')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })
})

describe('FootNote', () => {
  test('shows the note with a hidden icon, and the end slot', () => {
    renderWithProviders(<FootNote note="Progress is weighted." end="Today is October 15, 2026" />)
    expect(screen.getByText('Progress is weighted.')).toBeInTheDocument()
    expect(screen.getByText('Today is October 15, 2026')).toBeInTheDocument()
    expect(screen.getByText('ⓘ')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('DataTable', () => {
  const rows = [
    { id: 1, name: 'Beta', n: 2, grp: 'x' },
    { id: 2, name: 'Alpha', n: 1, grp: 'x' },
    { id: 3, name: 'Gamma', n: 2, grp: 'y' },
  ]
  const columns = [
    { key: 'name', header: 'Name', render: (r) => r.name, sortValue: (r) => r.name, sortable: true },
    { key: 'n', header: 'Count', render: (r) => r.n, sortValue: (r) => r.n, sortable: true, align: 'right' },
    { key: 'grp', header: 'Group', render: (r) => r.grp },
  ]
  const base = { ariaLabel: 'Things', columns, rows, getRowId: (r) => r.id }
  const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

  test('headers carry aria-sort and clicking asks for the next sort', async () => {
    const onSortChange = vi.fn()
    renderWithProviders(<DataTable {...base} sort={{ key: 'name', dir: 'asc' }} onSortChange={onSortChange} serverSort />)
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: /Count/ })).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', dir: 'desc' })
    await userEvent.click(screen.getByRole('button', { name: /Count/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'n', dir: 'asc' })
  })

  test('a descending sort is announced and applied', () => {
    renderWithProviders(<DataTable {...base} sort={{ key: 'name', dir: 'desc' }} onSortChange={() => {}} />)
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'descending')
    expect(names()).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  test('client sort is stable: equal values keep input order', async () => {
    renderWithProviders(<DataTable {...base} defaultSort={{ key: 'n', dir: 'asc' }} />)
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma'])
    await userEvent.click(screen.getByRole('button', { name: /Count/ }))
    expect(names()).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  test('server sort leaves the row order alone', () => {
    renderWithProviders(<DataTable {...base} serverSort sort={{ key: 'name', dir: 'asc' }} onSortChange={() => {}} />)
    expect(names()).toEqual(['Beta', 'Alpha', 'Gamma'])
  })

  test('clicking a row opens it', async () => {
    const onRowOpen = vi.fn()
    renderWithProviders(<DataTable {...base} onRowOpen={onRowOpen} />)
    await userEvent.click(screen.getByText('Alpha'))
    expect(onRowOpen).toHaveBeenCalledWith(rows[1])
  })

  test('visibleKeys hides the other columns', () => {
    renderWithProviders(<DataTable {...base} visibleKeys={['name']} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(1)
    expect(screen.queryByText('Group')).not.toBeInTheDocument()
  })

  test('totalRow renders a last row headed Total; selectedId marks the row', () => {
    renderWithProviders(<DataTable {...base} totalRow={{ name: 'Total', n: 5 }} selectedId={2}
      rowTone={(r) => (r.id === 1 ? 'warning' : null)} />)
    const all = screen.getAllByRole('row')
    const last = all[all.length - 1]
    expect(within(last).getByRole('rowheader', { name: 'Total' })).toBeInTheDocument()
    expect(within(last).getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Alpha').closest('tr')).toHaveAttribute('aria-current', 'true')
  })

  test('empty shows when there are no rows', () => {
    renderWithProviders(<DataTable {...base} rows={[]} empty={<p>Nothing here</p>} />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  test('pagination calls onPageChange', async () => {
    const onPageChange = vi.fn()
    renderWithProviders(<DataTable {...base} pagination={{ page: 0, pageSize: 3, total: 9, onPageChange }} />)
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  test('375 px: no table, each row a card of label: value pairs, with a Total card', () => {
    setViewport(375)
    renderWithProviders(<DataTable {...base} totalRow={{ name: 'Total', n: 5 }} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const cards = screen.getAllByRole('listitem')
    expect(cards).toHaveLength(4)
    expect(within(cards[0]).getByText('Count:')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Beta')).toBeInTheDocument()
    expect(within(cards[3]).getByText('Total')).toBeInTheDocument()
  })
  test('a click on a button inside a row runs its own handler, not onRowOpen', async () => {
    const onRowOpen = vi.fn()
    const onInner = vi.fn()
    const cols = [{ key: 'name', header: 'Name', render: (r) => <button onClick={() => onInner(r.id)}>{`Open ${r.name}`}</button> }]
    renderWithProviders(<DataTable {...base} columns={cols} onRowOpen={onRowOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'Open Alpha' }))
    expect(onInner).toHaveBeenCalledWith(2)
    expect(onRowOpen).not.toHaveBeenCalled()
  })

  test('a click in a menu opened from a cell does not open the row', async () => {
    const onRowOpen = vi.fn()
    const onPick = vi.fn()
    function Cell() {
      const [anchor, setAnchor] = useState(null)
      return (
        <>
          <button onClick={(e) => setAnchor(e.currentTarget)}>More</button>
          <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
            <MenuItem onClick={() => { onPick(); setAnchor(null) }}>Edit details</MenuItem>
          </Menu>
        </>
      )
    }
    const cols = [{ key: 'name', header: 'Name', render: (r) => (r.id === 1 ? <Cell /> : r.name) }]
    renderWithProviders(<DataTable {...base} columns={cols} onRowOpen={onRowOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit details' }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onRowOpen).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(document.querySelector('.MuiBackdrop-root'))
    expect(onRowOpen).not.toHaveBeenCalled()
  })

  test('null sort values go last in both directions', async () => {
    const data = [{ id: 1, name: 'A', n: null }, { id: 2, name: 'B', n: 3 }, { id: 3, name: 'C', n: 1 }]
    renderWithProviders(<DataTable {...base} rows={data} defaultSort={{ key: 'n', dir: 'asc' }} />)
    expect(names()).toEqual(['C', 'B', 'A'])
    await userEvent.click(screen.getByRole('button', { name: /Count/ }))
    expect(names()).toEqual(['B', 'C', 'A'])
  })

  test('aria-busy while loading', () => {
    const { container } = renderWithProviders(<DataTable {...base} loading />)
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  test('375 px with totalRow and onRowOpen: the Total card is not a button and keeps each label', async () => {
    setViewport(375)
    const onRowOpen = vi.fn()
    renderWithProviders(<DataTable {...base} totalRow={{ name: 'Total', n: 5, grp: 'all' }} onRowOpen={onRowOpen} />)
    const cards = screen.getAllByRole('listitem')
    const total = cards[cards.length - 1]
    expect(within(total).queryByRole('button')).not.toBeInTheDocument()
    expect(within(total).getByText('Total')).toBeInTheDocument()
    expect(within(total).getByText('Count:')).toBeInTheDocument()
    expect(within(total).getByText('Group:')).toBeInTheDocument()
    expect(within(total).getByText('all')).toBeInTheDocument()
    await userEvent.click(within(cards[0]).getByRole('button'))
    expect(onRowOpen).toHaveBeenCalledWith(rows[0])
  })

  test('375 px: cards carry rowTone and the selected row', () => {
    setViewport(375)
    renderWithProviders(<DataTable {...base} selectedId={2} rowTone={(r) => (r.id === 1 ? 'warning' : null)} />)
    const cards = screen.getAllByRole('listitem')
    expect(cards[0]).toHaveAttribute('data-tone', 'warning')
    expect(cards[1]).not.toHaveAttribute('data-tone')
    expect(cards[1]).toHaveAttribute('aria-current', 'true')
    expect(cards[0]).not.toHaveAttribute('aria-current')
  })
})

describe('SidePanel focus, more', () => {
  test('375 px: the title has focus after opening', async () => {
    setViewport(375)
    renderWithProviders(<PanelHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Kickoff' })).toHaveFocus()
  })

  test('unmounting while open gives focus back', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { unmount } = renderWithProviders(<SidePanel open title="T" onClose={() => {}} list={<p>list</p>}>x</SidePanel>)
    expect(screen.getByRole('heading', { level: 2, name: 'T' })).toHaveFocus()
    unmount()
    expect(outside).toHaveFocus()
    outside.remove()
  })
})

describe('KpiStrip, more', () => {
  const three = [{ key: 'a', label: 'one', value: '1' }, { key: 'b', label: 'two', value: '2' }, { key: 'c', label: 'three', value: '3' }]
  test('3 items in 2 phone columns leave no tinted empty cell', () => {
    setViewport(375)
    renderWithProviders(<KpiStrip ariaLabel="S" items={three} />)
    const grid = screen.getByRole('group', { name: 'S' }).firstElementChild
    expect(grid.children).toHaveLength(3)
    expect(['', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(getComputedStyle(grid).backgroundColor)
    expect(getComputedStyle(grid).gap).not.toBe('1px')
  })
  test('value-first puts the number before the label', () => {
    renderWithProviders(<KpiStrip ariaLabel="S" layout="value-first" items={three} />)
    const cell = screen.getByText('one').parentElement
    expect(cell.textContent).toBe('1one')
  })
  test('loading is announced as busy and shows no values', () => {
    renderWithProviders(<KpiStrip ariaLabel="S" items={three} loading />)
    expect(screen.getByRole('group', { name: 'S' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('one')).not.toBeInTheDocument()
  })
})
