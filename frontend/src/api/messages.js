// TanStack Query hooks for Messages. Kept apart from queries.js; every key starts with 'messages' so one
// invalidation refreshes the inbox, the badge and any open thread together.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client.js'

/** How often the inbox and the badge refresh: fast while Messages is open, at the normal pace elsewhere. */
export const FAST_POLL_MS = 5000
export const THREAD_POLL_MS = 3000
const NORMAL_POLL_MS = 30000

const poll = (fast) => (fast ? FAST_POLL_MS : NORMAL_POLL_MS)

export const messageKeys = {
  all: ['messages'],
  contacts: ['messages', 'contacts'],
  conversations: ['messages', 'conversations'],
  unread: ['messages', 'unread'],
  thread: (id) => ['messages', 'thread', String(id)],
  discussion: (milestoneId) => ['messages', 'discussion', String(milestoneId)],
}

/** Who the viewer may start a conversation with: {items, can_group}. Employees get only their managers. */
export const useContacts = (enabled = true) => useQuery({
  queryKey: messageKeys.contacts, queryFn: () => api.get('/messages/contacts'), enabled, staleTime: 60000,
  refetchInterval: false,
})

export const useConversations = ({ fast = false, enabled = true } = {}) => useQuery({
  queryKey: messageKeys.conversations, queryFn: () => api.get('/conversations'), enabled,
  refetchInterval: poll(fast), refetchIntervalInBackground: false,
})

export const useUnreadMessages = ({ fast = false, enabled = true } = {}) => useQuery({
  queryKey: messageKeys.unread, queryFn: () => api.get('/messages/unread-count'), enabled,
  refetchInterval: poll(fast), refetchIntervalInBackground: false,
})

const PAGE = 50

/** Two runs of messages as one, oldest first, each message once. */
export function mergeMessages(a = [], b = []) {
  const byId = new Map([...a, ...b].map((m) => [String(m.id), m]))
  return [...byId.values()].sort((x, y) => (x.created_at === y.created_at ? String(x.id).localeCompare(String(y.id))
    : new Date(x.created_at) - new Date(y.created_at)))
}

/**
 * A thread: {items (oldest first), has_more (older messages exist), conversation (with read receipts)}.
 * Each poll fetches the newest page and adds it to what's already loaded, so earlier pages fetched with
 * useLoadOlder stay on screen however many new messages arrive.
 */
export function useThread(id) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: messageKeys.thread(id),
    queryFn: async () => {
      const page = await api.get(`/conversations/${id}/messages`, { limit: PAGE })
      const before = queryClient.getQueryData(messageKeys.thread(id))
      // Keep what's loaded only while the new page joins onto it; after a long gap start again from the newest page.
      const joins = before && (!page.has_more || before.items.some((m) => String(m.id) === String(page.items[0]?.id)))
      return joins ? { ...page, items: mergeMessages(before.items, page.items),
        has_more: page.has_more && before.has_more } : page
    },
    enabled: Boolean(id), refetchInterval: THREAD_POLL_MS, refetchIntervalInBackground: false, staleTime: 0,
  })
}

/** "Load earlier messages": fetches the page before the oldest one shown and adds it to the thread. */
export function useLoadOlder(id) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const current = queryClient.getQueryData(messageKeys.thread(id))
      const oldest = current?.items?.[0]
      if (!oldest) return null
      const page = await api.get(`/conversations/${id}/messages`, { before: oldest.id, limit: PAGE })
      queryClient.setQueryData(messageKeys.thread(id), (was) => (was
        ? { ...was, items: mergeMessages(page.items, was.items), has_more: page.has_more } : was))
      return page
    },
  })
}

function useMessagesMutation(mutationFn, { extraKeys = [] } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => Promise.all([messageKeys.all, ...extraKeys].map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  })
}

/** {participant_ids, subject?, body} → the conversation (a one-to-one is reused if it exists). */
export const useStartConversation = () => useMessagesMutation((body) => api.post('/conversations', body),
  { extraKeys: [['notifications']] })

export const useSendMessage = (id) => useMessagesMutation((body) => api.post(`/conversations/${id}/messages`, { body }))

/** Marking a conversation read also clears its bell alert. */
export const useMarkConversationRead = () => useMessagesMutation((id) => api.post(`/conversations/${id}/read`),
  { extraKeys: [['notifications']] })

/** Open (or, for the project's manager or an admin, start) a milestone's discussion → the conversation. */
export const useOpenDiscussion = () => useMessagesMutation((milestoneId) => api.post(`/milestones/${milestoneId}/discussion`))

/** Is the viewer in a milestone's discussion? Read from their own conversations (always a 200), so a page that only needs
 * yes or no never asks the milestone and gets a 404 (a console error) for every milestone without one. */
export const useInDiscussion = (milestoneId, enabled = true) => useQuery({
  queryKey: messageKeys.conversations, queryFn: () => api.get('/conversations'),
  enabled: enabled && Boolean(milestoneId), refetchInterval: false,
  select: (data) => (data?.items ?? []).some((c) => c.milestone && String(c.milestone.id) === String(milestoneId)),
})

/** A milestone's discussion conversation, or a 404 error until one exists (not retried: the 404 is the answer). */
export const useMilestoneDiscussion = (milestoneId, enabled = true) => useQuery({
  queryKey: messageKeys.discussion(milestoneId), queryFn: () => api.get(`/milestones/${milestoneId}/discussion`),
  enabled: enabled && Boolean(milestoneId), retry: (count, err) => err?.status !== 404 && count < 2,
  refetchInterval: false,
})
