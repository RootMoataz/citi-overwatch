import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ApiError } from '../api/client.js'
import { renderWithProviders } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import EmptyState from './EmptyState.jsx'
import ErrorAlert from './ErrorAlert.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import PageHeader from './PageHeader.jsx'
import ResponsiveTable from './ResponsiveTable.jsx'
import RiskBadges from './RiskBadges.jsx'
import StatusChip from './StatusChip.jsx'

describe('shared components', () => {
  test('ErrorAlert shows ref id', () => {
    const err = new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'abc123' })
    renderWithProviders(<ErrorAlert error={err} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Internal server error')
    expect(screen.getByRole('alert')).toHaveTextContent('ref: abc123')
  })

  test('ErrorAlert renders nothing without an error and retries on demand', async () => {
    const { container } = renderWithProviders(<ErrorAlert error={null} />)
    expect(container).toBeEmptyDOMElement()
    const onRetry = vi.fn()
    renderWithProviders(<ErrorAlert error={new Error('boom')} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  test('StatusChip renders text label', () => {
    renderWithProviders(<StatusChip status="ready_for_review" />)
    expect(screen.getByText('Ready for review')).toBeInTheDocument()
    renderWithProviders(<StatusChip status="on_hold" />)
    expect(screen.getByText('On hold')).toBeInTheDocument()
  })

  test('RiskBadges translate reason codes', () => {
    renderWithProviders(<RiskBadges reasons={['OVERDUE_MILESTONE', 'PAST_DUE', 'BUDGET_BURN']} />)
    for (const text of ['Overdue milestone', 'Past due date', 'Budget burning faster than progress']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  test('RiskBadges show on-track when there are no reasons', () => {
    renderWithProviders(<RiskBadges reasons={[]} />)
    expect(screen.getByText('On track')).toBeInTheDocument()
  })

  test('EmptyState and PageHeader render their actions', () => {
    renderWithProviders(<>
      <PageHeader title="Projects" subtitle="All work" actions={<button type="button">New</button>} />
      <EmptyState title="No projects yet" description="Create the first one" action={<button type="button">Create</button>} />
    </>)
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  test('ConfirmDialog confirms and cancels', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<ConfirmDialog open title="Archive project?" body="You can restore it later."
      confirmLabel="Archive" onConfirm={onConfirm} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Archive project?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(onConfirm).toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('ResponsiveTable shows cards on phones and a grid on desktop', () => {
    const rows = [{ id: 1, name: 'Apollo' }]
    const columns = [{ field: 'name', headerName: 'Name', flex: 1 }]
    setViewport(390)
    renderWithProviders(<ResponsiveTable rows={rows} columns={columns} renderCard={(r) => <span>card {r.name}</span>} />)
    expect(screen.getByText('card Apollo')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  test('ResponsiveTable shows an empty state when there are no rows', () => {
    setViewport(390)
    renderWithProviders(<ResponsiveTable rows={[]} columns={[]} renderCard={() => null}
      emptyState={<EmptyState title="Nothing here" />} />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  test('a crashing screen shows a recoverable message instead of a blank page', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom() { throw new Error('kaboom') }
    renderWithProviders(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    spy.mockRestore()
  })
})
