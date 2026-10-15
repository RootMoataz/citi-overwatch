import { act, renderHook, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AppProviders } from '../app/providers.jsx'
import { makeQueryClient } from '../app/queryClient.js'
import { API, HttpResponse, http, server } from '../test/server.js'
import { api } from './client.js'
import { useApproveEntry, useMilestoneStatus, useUpdateProject } from './queries.js'

const celebrate = vi.fn()
vi.mock('../lib/celebrate.js', () => ({ celebrate: (...args) => celebrate(...args) }))

function setup(hook) {
  const queryClient = makeQueryClient({ test: true })
  const wrapper = ({ children }) => <AppProviders queryClient={queryClient}>{children}</AppProviders>
  return { ...renderHook(hook, { wrapper }), queryClient }
}

describe('celebrations', () => {
  beforeEach(() => celebrate.mockReset())

  test('a milestone marked completed celebrates; other statuses do not', async () => {
    server.use(http.post(`${API}/milestones/:id/status`, () => HttpResponse.json({ id: 'm1' })))
    const { result } = setup(() => useMilestoneStatus('p1'))
    await act(() => result.current.mutateAsync({ id: 'm1', status: 'in_progress' }))
    expect(celebrate).not.toHaveBeenCalled()
    await act(() => result.current.mutateAsync({ id: 'm1', status: 'completed' }))
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1))
  })

  test('approving the last waiting entry celebrates the empty queue', async () => {
    let queue = [{ entry: { id: 'e1' } }, { entry: { id: 'e2' } }]
    server.use(
      http.get(`${API}/approvals`, () => HttpResponse.json(queue)),
      http.post(`${API}/time-entries/:id/approve`, ({ params }) => {
        queue = queue.filter((i) => i.entry.id !== params.id)
        return HttpResponse.json({ id: params.id })
      }),
    )
    const { result } = setup(() => ({
      approvals: useQuery({ queryKey: ['approvals', {}], queryFn: () => api.get('/approvals') }),
      approve: useApproveEntry(),
    }))
    await waitFor(() => expect(result.current.approvals.data).toHaveLength(2))
    await act(() => result.current.approve.mutateAsync({ id: 'e1', expectedHours: 8 }))
    expect(celebrate).not.toHaveBeenCalled()
    await act(() => result.current.approve.mutateAsync({ id: 'e2', expectedHours: 8 }))
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1))
  })

  test('a project newly marked completed celebrates; saving an already completed one does not', async () => {
    let status = 'active'
    server.use(
      http.get(`${API}/projects/p1`, () => HttpResponse.json({ id: 'p1', status })),
      http.put(`${API}/projects/p1`, async ({ request }) => { status = (await request.json()).status; return HttpResponse.json({ id: 'p1', status }) }),
    )
    const { result } = setup(() => ({
      project: useQuery({ queryKey: ['project', 'p1'], queryFn: () => api.get('/projects/p1') }),
      update: useUpdateProject('p1'),
    }))
    await waitFor(() => expect(result.current.project.data?.status).toBe('active'))
    await act(() => result.current.update.mutateAsync({ status: 'completed' }))
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.project.data?.status).toBe('completed'))
    await act(() => result.current.update.mutateAsync({ status: 'completed', name: 'Renamed' }))
    expect(celebrate).toHaveBeenCalledTimes(1)
  })
})
