import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ApiError } from '../api/client.js'
import { renderAsUser, renderWithProviders, users } from '../test/render.jsx'
import { setViewport } from '../test/setup.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import EmptyState from './EmptyState.jsx'
import ErrorAlert from './ErrorAlert.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import PageHeader from './PageHeader.jsx'
import PersonLink from './PersonLink.jsx'
import PersonWithAvatar from './PersonWithAvatar.jsx'
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

  test('StatusChip with icon keeps the same label and adds an icon; waiting is striped', () => {
    const { unmount } = renderWithProviders(<StatusChip status="completed" icon />)
    const chip = screen.getByText('Completed').closest('.MuiChip-root')
    expect(chip.querySelector('.MuiChip-icon')).not.toBeNull()
    expect(chip.querySelector('.MuiChip-icon')).toHaveAttribute('aria-hidden', 'true')
    unmount()
    const plain = renderWithProviders(<StatusChip status="completed" />)
    expect(screen.getByText('Completed').closest('.MuiChip-root').querySelector('.MuiChip-icon')).toBeNull()
    plain.unmount()
    renderWithProviders(<StatusChip status="waiting" icon />)
    const waiting = screen.getByText('Waiting on dependencies').closest('.MuiChip-root').querySelector('.MuiChip-icon')
    expect(getComputedStyle(waiting).backgroundImage).toContain('repeating-linear-gradient')
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

describe('people link to their profile only when the viewer may open it', () => {
  const ada = { id: 'u-ada', name: 'Ada Lovelace' }
  const project = { id: 'p1', manager: { id: users.manager.id }, is_archived: false }

  test('admins get a link to anyone', () => {
    renderAsUser(<PersonWithAvatar person={ada} />, { user: users.admin })
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/people/u-ada/profile')
  })

  test("employees see other people's names as plain text, and their own as a link", () => {
    renderAsUser(<><PersonLink person={ada} /><PersonLink person={{ id: users.employee.id, name: 'Eli Employee' }} /></>,
      { user: users.employee })
    expect(screen.getByText('Ada Lovelace')).not.toHaveAttribute('href')
    expect(screen.queryByRole('link', { name: 'Ada Lovelace' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Eli Employee' })).toHaveAttribute('href', `/people/${users.employee.id}/profile`)
  })

  test("managers get a link for people on their own project, plain text elsewhere", () => {
    renderAsUser(<>
      <PersonWithAvatar person={ada} context={{ project }} />
      <PersonWithAvatar person={{ id: 'u-bo', name: 'Bo Other' }} context={{ project: { ...project, manager: { id: 'u-x' } } }} />
    </>, { user: users.manager })
    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Bo Other' })).not.toBeInTheDocument()
    expect(screen.getByText('Bo Other')).toBeInTheDocument()
  })

  test('link={false} keeps a name as text even for admins (e.g. inside a tappable card)', () => {
    renderAsUser(<PersonWithAvatar person={ada} link={false} />, { user: users.admin })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('clicking the name does not also trigger the row it sits in', async () => {
    const onRow = vi.fn()
    renderAsUser(<div role="presentation" onClick={onRow}><PersonLink person={ada} /></div>, { user: users.admin })
    await userEvent.click(screen.getByRole('link', { name: 'Ada Lovelace' }))
    expect(onRow).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/people/u-ada/profile')
  })
})
