import type { InboxCache, InboxItem } from '../types'

// 이만큼 지나지 않은 조회 결과는 어느 세션이든 파일에서 그대로 쓴다
export const INBOX_TTL_MS = 15 * 60 * 1000
// 패널을 열거나 새로고침을 눌러도 이보다 짧은 간격으로는 다시 부르지 않는다
export const FORCE_MIN_MS = 30 * 1000
// 조회를 맡은 세션이 이 안에 끝내지 못하면(꺼졌거나 멈췄으면) 다른 세션이 넘겨받는다
export const LEASE_MS = 2 * 60 * 1000

export const emptyCache = (): InboxCache => ({
  fetchedAt: null,
  okAt: null,
  notifications: [],
  seenIds: [],
  lease: null,
})

// 공유 캐시 파일이 깨졌거나 예전 모양이어도 빈 값으로 읽는다
export const parseCache = (text: string): InboxCache => {
  try {
    const raw = JSON.parse(text) as Partial<InboxCache> | null
    if (!raw || typeof raw !== 'object') {
      return emptyCache()
    }
    return {
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
      okAt: typeof raw.okAt === 'number' ? raw.okAt : null,
      notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
      seenIds: Array.isArray(raw.seenIds) ? raw.seenIds.filter(id => typeof id === 'string') : [],
      lease:
        raw.lease && typeof raw.lease.by === 'string' && typeof raw.lease.at === 'number'
          ? { by: raw.lease.by, at: raw.lease.at }
          : null,
    }
  } catch {
    return emptyCache()
  }
}

// https://linear.app/<workspace>/issue/ABC-615/... 에서 이슈 번호를 뽑는다
export const issueFromUrl = (url: string | null): string | null =>
  url?.match(/\/issue\/([A-Za-z]+-\d+)/)?.[1]?.toUpperCase() ?? null

type RawNotification = {
  id?: unknown
  type?: unknown
  category?: unknown
  title?: unknown
  subtitle?: unknown
  url?: unknown
  createdAt?: unknown
  archivedAt?: unknown
  snoozedUntilAt?: unknown
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

// 패널에 한 줄로 보이게 비어 있지 않은 첫 줄만 남긴다
const oneLine = (value: unknown): string | null =>
  str(value)
    ?.split('\n')
    .map(line => line.trim())
    .find(Boolean) ?? null

// get_notifications 의 text 블록을 읽는다. 모양이 다르면 null
export const parseNotifications = (text: string, now: number): InboxItem[] | null => {
  let parsed: { notifications?: unknown }
  try {
    parsed = JSON.parse(text) as { notifications?: unknown }
  } catch {
    return null
  }
  if (!parsed || !Array.isArray(parsed.notifications)) {
    return null
  }
  return (parsed.notifications as RawNotification[]).flatMap(raw => {
    const id = str(raw.id)
    if (!id || raw.archivedAt) {
      return []
    }
    // 미뤄 둔 알림은 그 시각이 지나야 보인다
    const snoozedUntil = str(raw.snoozedUntilAt)
    if (snoozedUntil && Date.parse(snoozedUntil) > now) {
      return []
    }
    const url = str(raw.url)
    const createdAt = Date.parse(str(raw.createdAt) ?? '')
    return [
      {
        id,
        type: str(raw.type) ?? 'unknown',
        category: str(raw.category),
        title: oneLine(raw.title) ?? '',
        subtitle: oneLine(raw.subtitle),
        url,
        issue: issueFromUrl(url),
        createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
      },
    ]
  })
}

// 사람이 답해야 할 것이 위로 오게 둔 순서. 여기 없는 카테고리는 그 아래에 둔다
const CATEGORY_ORDER = [
  'mentions',
  'commentsAndReplies',
  'assignments',
  'reviews',
  'statusChanges',
  'reminders',
  'triage',
  'subscriptions',
  'reactions',
  'documentChanges',
]

const CATEGORY_LABEL: Record<string, string> = {
  mentions: '멘션',
  commentsAndReplies: '댓글',
  assignments: '배정',
  reviews: '리뷰',
  statusChanges: '상태',
  reminders: '리마인더',
  triage: '트리아지',
  subscriptions: '구독',
  reactions: '반응',
  documentChanges: '문서',
}

// category 가 비어 오면 type 이름으로 짐작한다
export const categoryOf = (item: Pick<InboxItem, 'type' | 'category'>): string => {
  if (item.category) {
    return item.category
  }
  const type = item.type
  if (/Mention/i.test(type)) {
    return 'mentions'
  }
  if (/Comment|Reply/i.test(type)) {
    return 'commentsAndReplies'
  }
  if (/Assigned/i.test(type)) {
    return 'assignments'
  }
  if (/Status|Blocked|Unblocked/i.test(type)) {
    return 'statusChanges'
  }
  if (/Reaction/i.test(type)) {
    return 'reactions'
  }
  if (/Document|Description/i.test(type)) {
    return 'documentChanges'
  }
  return type
}

// 나를 태그했거나 내 댓글에 답한 알림만 남긴다. GitLab 연동이 바꾼 상태나 배정 같은 알림은 보이지 않는다
const FOR_ME = new Set(['mentions', 'commentsAndReplies'])

export const onlyForMe = (items: readonly InboxItem[]): InboxItem[] =>
  items.filter(item => FOR_ME.has(categoryOf(item)))

// 모르는 카테고리는 이름 그대로 보인다
export const categoryLabel = (item: Pick<InboxItem, 'type' | 'category'>): string => {
  const category = categoryOf(item)
  return CATEGORY_LABEL[category] ?? category
}

const rank = (item: InboxItem): number => {
  const index = CATEGORY_ORDER.indexOf(categoryOf(item))
  return index === -1 ? CATEGORY_ORDER.length : index
}

// 카테고리 순서대로, 같은 카테고리 안에서는 최신을 위로
export const sortInbox = (items: readonly InboxItem[]): InboxItem[] =>
  [...items].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)

// 지금 조회해야 하는지. 다른 세션이 조회 중이면 그 결과를 기다린다. 이슈 조회도 같은 규칙을 주기만 바꿔 쓴다
export const shouldFetch = (
  cache: Pick<InboxCache, 'fetchedAt' | 'lease'>,
  now: number,
  me: string,
  isForced: boolean,
  ttlMs: number = INBOX_TTL_MS,
): boolean => {
  if (cache.lease && cache.lease.by !== me && now - cache.lease.at < LEASE_MS) {
    return false
  }
  const age = cache.fetchedAt === null ? Infinity : now - cache.fetchedAt
  return age >= (isForced ? FORCE_MIN_MS : ttlMs)
}

// 조회 결과를 캐시에 반영하고, 토스트할 새 알림을 돌려준다. fetched 가 null 이면 조회 실패
export const applyFetch = (
  prev: InboxCache,
  fetched: InboxItem[] | null,
  now: number,
): { cache: InboxCache; fresh: InboxItem[] } => {
  if (fetched === null) {
    // 실패해도 fetchedAt 을 남겨 모든 세션이 15분 동안 다시 부르지 않게 한다. 본 목록은 그대로 둔다
    return { cache: { ...prev, fetchedAt: now, notifications: [], lease: null }, fresh: [] }
  }
  const seen = new Set(prev.seenIds)
  // 처음 성공한 조회에서는 이미 쌓여 있던 알림을 새 알림으로 치지 않는다
  const fresh = prev.okAt === null ? [] : fetched.filter(item => !seen.has(item.id))
  return {
    cache: {
      fetchedAt: now,
      okAt: now,
      notifications: fetched,
      // 지금 목록에 있는 것만 남겨 파일이 끝없이 자라지 않게 한다
      seenIds: fetched.map(item => item.id),
      lease: null,
    },
    fresh,
  }
}

// 알림 줄 끝에 붙는 시각. 제목 옆 좁은 칸에서 꺾이지 않게 3h 처럼 짧게 쓴다
export const formatAgoShort = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

const TOAST_TITLE_MAX = 40

export const toastText = (fresh: readonly InboxItem[]): string => {
  const [top] = sortInbox(fresh)
  if (!top) {
    return ''
  }
  const title = top.title.length > TOAST_TITLE_MAX ? `${top.title.slice(0, TOAST_TITLE_MAX)}…` : top.title
  const head = `Linear ${top.issue ? `${top.issue} ` : ''}${categoryLabel(top)}: ${title}`
  return fresh.length > 1 ? `${head} 외 ${fresh.length - 1}개` : head
}
