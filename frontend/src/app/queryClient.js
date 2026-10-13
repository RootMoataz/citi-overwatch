import { QueryClient } from '@tanstack/react-query'

/** Query defaults: "real-time" refresh every 30s and on tab focus; never retry 4xx errors. */
export function makeQueryClient({ test = false } = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: test ? false : 30000,
        refetchOnWindowFocus: !test,
        staleTime: 10000,
        retry: (count, error) => !test && (error?.status ?? 500) >= 500 && count < 2,
      },
      mutations: { retry: false },
    },
  })
}
