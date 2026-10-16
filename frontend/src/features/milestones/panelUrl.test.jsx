import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { renderAsUser, users } from '../../test/render.jsx'
import { useMilestonePanelUrl } from './useMilestonePanelUrl.js'

const GONE = 'That milestone is no longer available.'
const m1 = { id: 'm1', name: 'Discovery' }
const location = () => screen.getByTestId('location')

// A stand-in for the tab: `list` plays useMilestones' data; "Server drops it" makes the next refetch come back without m1.
function Harness({ initial, refetchSpy }) {
  const [list, setList] = useState(initial)
  const [serverList, setServerList] = useState(initial)
  const [fetching, setFetching] = useState(false)
  const refetch = async () => {
    refetchSpy()
    setFetching(true)
    await Promise.resolve()
    setList(serverList)
    setFetching(false)
    return { data: serverList }
  }
  const panel = useMilestonePanelUrl({ data: list, isSuccess: true, isFetching: fetching, refetch })
  const navigate = useNavigate()
  return (
    <>
      <p>{panel.current ? `Showing ${panel.current.name}` : 'No panel'}</p>
      <button type="button" onClick={() => panel.open(m1)}>Open Discovery</button>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <button type="button" onClick={() => panel.archiveStarted(m1)}>Start archive</button>
      <button type="button" onClick={() => panel.archiveFailed(m1)}>Archive failed</button>
      <button type="button" onClick={() => setServerList([])}>Server drops it</button>
      <button type="button" onClick={() => setList([])}>List drops it</button>
    </>
  )
}

const renderHarness = (initial, route, entries) => {
  const refetchSpy = vi.fn()
  renderAsUser(<Harness initial={initial} refetchSpy={refetchSpy} />, { user: users.manager, route, entries })
  return refetchSpy
}

describe('useMilestonePanelUrl', () => {
  test('a milestone missing from a stale list is refetched once; the panel opens when the server has it', async () => {
    const refetchSpy = vi.fn()
    function Stale() {
      const [list, setList] = useState([])
      const [fetching, setFetching] = useState(false)
      const refetch = async () => {
        refetchSpy()
        setFetching(true)
        await Promise.resolve()
        setList([m1])
        setFetching(false)
      }
      const panel = useMilestonePanelUrl({ data: list, isSuccess: true, isFetching: fetching, refetch })
      return <p>{panel.current ? `Showing ${panel.current.name}` : 'No panel'}</p>
    }
    renderAsUser(<Stale />, { user: users.manager, route: '/m?milestone=m1' })
    expect(await screen.findByText('Showing Discovery')).toBeInTheDocument()
    expect(refetchSpy).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(GONE)).not.toBeInTheDocument()
    expect(location()).toHaveTextContent('/m?milestone=m1')
  })

  test('still missing after that one refetch: the panel closes with the toast', async () => {
    const refetchSpy = renderHarness([], '/m?milestone=m1&panel=notes')
    expect(await screen.findByText(GONE)).toBeInTheDocument()
    await waitFor(() => expect(location()).toHaveTextContent(/^\/m$/))
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  test('a milestone this viewer archived closes its panel without the toast', async () => {
    renderHarness([m1], '/m?milestone=m1')
    expect(screen.getByText('Showing Discovery')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start archive' }))
    await user.click(screen.getByRole('button', { name: 'Server drops it' }))
    await user.click(screen.getByRole('button', { name: 'List drops it' }))
    await waitFor(() => expect(location()).toHaveTextContent(/^\/m$/))
    expect(screen.queryByText(GONE)).not.toBeInTheDocument()
  })

  test('a failed archive no longer silences the toast when the milestone later vanishes', async () => {
    renderHarness([m1], '/m?milestone=m1')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start archive' }))
    await user.click(screen.getByRole('button', { name: 'Archive failed' }))
    await user.click(screen.getByRole('button', { name: 'Server drops it' }))
    await user.click(screen.getByRole('button', { name: 'List drops it' }))
    expect(await screen.findByText(GONE)).toBeInTheDocument()
    await waitFor(() => expect(location()).toHaveTextContent(/^\/m$/))
  })

  test('a panel opened here whose milestone vanishes closes by going back, so no dead entry is left', async () => {
    renderHarness([m1], undefined, ['/before', '/m'])
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open Discovery' }))
    expect(location()).toHaveTextContent('/m?milestone=m1')
    await user.click(screen.getByRole('button', { name: 'Server drops it' }))
    await user.click(screen.getByRole('button', { name: 'List drops it' }))
    expect(await screen.findByText(GONE)).toBeInTheDocument()
    await waitFor(() => expect(location()).toHaveTextContent(/^\/m$/))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(location()).toHaveTextContent(/^\/before$/)
  })

  test('a refetch that fails is handled: no unhandled rejection, one request, no toast, and the URL stays', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const refetchSpy = vi.fn()
    function Failing() {
      const refetch = () => { refetchSpy(); return Promise.reject(new Error('Network down')) }
      const panel = useMilestonePanelUrl({ data: [], isSuccess: true, isFetching: false, refetch })
      return <p>{panel.current ? 'Showing' : 'No panel'}</p>
    }
    try {
      renderAsUser(<Failing />, { user: users.manager, route: '/m?milestone=m1' })
      await waitFor(() => expect(refetchSpy).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 50))   // past the rejection's microtasks
      expect(unhandled).not.toHaveBeenCalled()
      expect(refetchSpy).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(GONE)).not.toBeInTheDocument()
      expect(screen.getByText('No panel')).toBeInTheDocument()
      expect(location()).toHaveTextContent('/m?milestone=m1')
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
