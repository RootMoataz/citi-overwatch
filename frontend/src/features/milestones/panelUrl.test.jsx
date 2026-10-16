import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
  return (
    <>
      <p>{panel.current ? `Showing ${panel.current.name}` : 'No panel'}</p>
      <button type="button" onClick={() => panel.archiveStarted(m1)}>Start archive</button>
      <button type="button" onClick={() => panel.archiveFailed(m1)}>Archive failed</button>
      <button type="button" onClick={() => setServerList([])}>Server drops it</button>
      <button type="button" onClick={() => setList([])}>List drops it</button>
    </>
  )
}

const renderHarness = (initial, route) => {
  const refetchSpy = vi.fn()
  renderAsUser(<Harness initial={initial} refetchSpy={refetchSpy} />, { user: users.manager, route })
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
})
