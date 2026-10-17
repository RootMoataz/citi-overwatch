import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AppProviders } from '../../app/providers.jsx'
import { makeQueryClient } from '../../app/queryClient.js'
import { MemoryRouter } from 'react-router-dom'
import { useApproveManual, useEditManualHours, useLogManualHours, useManualHours, useRequestManualChanges,
  useWithdrawManualHours } from '../../api/queries.js'
import { API, HttpResponse, http, server } from '../../test/server.js'

const wrapper = ({ children }) => (
  <AppProviders queryClient={makeQueryClient({ test: true })}><MemoryRouter>{children}</MemoryRouter></AppProviders>)
const item = { entry: { id: 'e1', hours: 2, updated_at: '2026-10-15T10:00:00+00:00' }, user: { name: 'Ben Okafor' } }

describe('the manual hours hooks', () => {
  test('useManualHours lists with filters', async () => {
    let query
    server.use(http.get(`${API}/manual-hours`, ({ request }) => {
      query = new URL(request.url).search
      return HttpResponse.json([{ entry: { id: 'e1' } }])
    }))
    const { result } = renderHook(() => useManualHours({ project: 'p1' }), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(query).toBe('?project=p1')
  })

  test('useManualHours stays quiet when disabled', () => {
    const { result } = renderHook(() => useManualHours({}, false), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  test('useLogManualHours posts and toasts', async () => {
    let body
    server.use(http.post(`${API}/manual-hours`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ entry: { hours: 2, work_date: '2026-10-16' }, week_start: '2026-10-12' }, { status: 201 })
    }))
    const { result } = renderHook(() => useLogManualHours(), { wrapper })
    await act(() => result.current.mutateAsync({ body: { hours: '2' }, name: 'Schema Mapping' }))
    expect(body).toEqual({ hours: '2' })
    expect(await screen.findByText('Sent 2h on Schema Mapping (Fri 16 Oct) for review')).toBeInTheDocument()
  })

  test('useEditManualHours puts to the entry', async () => {
    let seen
    server.use(http.put(`${API}/manual-hours/e1`, async ({ request }) => {
      seen = await request.json()
      return HttpResponse.json({ entry: { hours: 2.5, work_date: '2026-10-16' } })
    }))
    const { result } = renderHook(() => useEditManualHours(), { wrapper })
    await act(() => result.current.mutateAsync({ id: 'e1', body: { hours: '2.5' }, name: 'Schema Mapping' }))
    expect(seen).toEqual({ hours: '2.5' })
    expect(await screen.findByText('Sent 2.5h on Schema Mapping (Fri 16 Oct) for review')).toBeInTheDocument()
  })

  test('useWithdrawManualHours deletes and toasts', async () => {
    let called = false
    server.use(http.delete(`${API}/manual-hours/e1`, () => { called = true; return HttpResponse.json({ withdrawn: 'e1' }) }))
    const { result } = renderHook(() => useWithdrawManualHours(), { wrapper })
    await act(() => result.current.mutateAsync({ id: 'e1', name: 'Schema Mapping', hours: 2, date: '2026-10-16' }))
    expect(called).toBe(true)
    expect(await screen.findByText('Withdrew 2h on Schema Mapping (Fri 16 Oct)')).toBeInTheDocument()
  })

  test('useApproveManual sends the hours and version it saw', async () => {
    let seen
    server.use(http.post(`${API}/manual-hours/e1/approve`, async ({ request }) => {
      seen = await request.json()
      return HttpResponse.json({ id: 'e1', status: 'approved' })
    }))
    const { result } = renderHook(() => useApproveManual(), { wrapper })
    await act(() => result.current.mutateAsync({ item }))
    expect(seen).toEqual({ expected_hours: 2, expected_updated_at: '2026-10-15T10:00:00+00:00' })
    expect(await screen.findByText('Approved 2h for Ben Okafor')).toBeInTheDocument()
  })

  test('useRequestManualChanges sends the reason with the same guard', async () => {
    let seen
    server.use(http.post(`${API}/manual-hours/e1/request-changes`, async ({ request }) => {
      seen = await request.json()
      return HttpResponse.json({ id: 'e1', status: 'rejected' })
    }))
    const { result } = renderHook(() => useRequestManualChanges(), { wrapper })
    await act(() => result.current.mutateAsync({ item, reason: 'Wrong day' }))
    expect(seen).toEqual({ reason: 'Wrong day', expected_hours: 2, expected_updated_at: '2026-10-15T10:00:00+00:00' })
    expect(await screen.findByText('Sent back to Ben Okafor')).toBeInTheDocument()
  })

  test('a decision invalidates the manual list', async () => {
    let lists = 0
    server.use(http.get(`${API}/manual-hours`, () => { lists += 1; return HttpResponse.json([]) }),
      http.post(`${API}/manual-hours/e1/approve`, () => HttpResponse.json({ id: 'e1' })))
    const { result } = renderHook(() => ({ list: useManualHours(), approve: useApproveManual() }), { wrapper })
    await waitFor(() => expect(lists).toBe(1))
    await act(() => result.current.approve.mutateAsync({ item }))
    await waitFor(() => expect(lists).toBe(2))
  })
})
