import { expect, test } from 'claude-code/testing'

import type { InboxCache, InboxItem } from '../types'
import {
  applyFetch,
  categoryLabel,
  emptyCache,
  formatAgoShort,
  FORCE_MIN_MS,
  INBOX_TTL_MS,
  issueFromUrl,
  onlyForMe,
  LEASE_MS,
  parseCache,
  parseNotifications,
  shouldFetch,
  sortInbox,
  toastText,
} from './inbox-lib'

const NOW = Date.parse('2026-10-12T06:00:00.000Z')

const RESPONSE = JSON.stringify({
  notifications: [
    {
      id: 'n1',
      type: 'issueUnblocked',
      title: 'Rack Advanced Setting 정리',
      subtitle: 'GitLab marked this issue as no longer blocked by ABC-620\n둘째 줄',
      url: 'https://linear.app/acme/issue/ABC-615/rack-advanced',
      category: 'statusChanges',
      isPriority: false,
      createdAt: '2026-10-12T05:45:55.877Z',
      readAt: null,
      archivedAt: null,
      snoozedUntilAt: null,
    },
    {
      id: 'n2',
      type: 'projectDescriptionContentChange',
      title: '프로젝트 설명 변경',
      url: 'https://linear.app/acme/project/web',
      category: 'documentChanges',
      createdAt: '2026-10-12T05:50:00.000Z',
    },
    { id: 'n3', type: 'issueNewComment', title: '댓글', url: 'https://linear.app/x/issue/abc-1/a', createdAt: '2026-10-12T05:00:00.000Z' },
    { id: 'n4', type: 'issueMention', title: '보관됨', archivedAt: '2026-10-12T05:00:00.000Z' },
    { id: 'n5', type: 'issueMention', title: '미룸', snoozedUntilAt: '2026-10-13T00:00:00.000Z' },
    { id: 'n6', type: 'somethingNew', title: '처음 보는 type', createdAt: 'x' },
    { type: 'issueMention', title: 'id 없음' },
  ],
  hasNextPage: false,
})

const item = (patch: Partial<InboxItem>): InboxItem => ({
  id: 'a',
  type: 'issueNewComment',
  category: null,
  title: 't',
  subtitle: null,
  url: null,
  issue: null,
  createdAt: 0,
  ...patch,
})

test('응답에서 이슈 번호와 한 줄 subtitle 을 뽑고, 보관하거나 미룬 알림은 뺀다', () => {
  const items = parseNotifications(RESPONSE, NOW)
  expect(items?.map(i => i.id)).toEqual(['n1', 'n2', 'n3', 'n6'])
  expect(items?.[0]).toMatchObject({
    issue: 'ABC-615',
    subtitle: 'GitLab marked this issue as no longer blocked by ABC-620',
    createdAt: Date.parse('2026-10-12T05:45:55.877Z'),
  })
  expect(items?.[1]?.issue).toBeNull()
  expect(items?.[2]?.issue).toBe('ABC-1')
  expect(items?.[3]).toMatchObject({ type: 'somethingNew', createdAt: 0 })
})

test('모양이 다른 응답은 null 이다', () => {
  expect(parseNotifications('not json', NOW)).toBeNull()
  expect(parseNotifications('{"error":"x"}', NOW)).toBeNull()
  expect(issueFromUrl(null)).toBeNull()
})

test('멘션과 댓글이 위로, 같은 카테고리는 최신이 위로, 모르는 type 은 맨 아래로 간다', () => {
  const sorted = sortInbox([
    item({ id: 'doc', category: 'documentChanges', createdAt: 9 }),
    item({ id: 'odd', type: 'somethingNew', createdAt: 10 }),
    item({ id: 'status', category: 'statusChanges', createdAt: 8 }),
    item({ id: 'old-comment', type: 'issueNewComment', createdAt: 1 }),
    item({ id: 'new-comment', type: 'issueNewComment', createdAt: 2 }),
    item({ id: 'mention', type: 'issueCommentMention', createdAt: 0 }),
  ])
  expect(sorted.map(i => i.id)).toEqual(['mention', 'new-comment', 'old-comment', 'status', 'doc', 'odd'])
  expect(categoryLabel(item({ type: 'issueCommentMention' }))).toBe('mention')
  expect(categoryLabel(item({ type: 'somethingNew' }))).toBe('somethingNew')
})

test('15분 안의 캐시는 파일만 읽고, 다른 세션이 조회 중이면 기다린다', () => {
  const fresh: InboxCache = { ...emptyCache(), fetchedAt: NOW - INBOX_TTL_MS + 1 }
  expect(shouldFetch(emptyCache(), NOW, 'me', false)).toBe(true)
  expect(shouldFetch(fresh, NOW, 'me', false)).toBe(false)
  expect(shouldFetch({ ...fresh, fetchedAt: NOW - INBOX_TTL_MS }, NOW, 'me', false)).toBe(true)
  // 패널을 열 때는 30초만 지나면 다시 부른다
  expect(shouldFetch(fresh, NOW, 'me', true)).toBe(true)
  expect(shouldFetch({ ...fresh, fetchedAt: NOW - FORCE_MIN_MS + 1 }, NOW, 'me', true)).toBe(false)
  // 다른 세션이 맡은 조회는 끝나기를 기다리고, LEASE_MS 가 지나면 넘겨받는다
  const leased: InboxCache = { ...emptyCache(), lease: { by: 'other', at: NOW - 1000 } }
  expect(shouldFetch(leased, NOW, 'me', true)).toBe(false)
  expect(shouldFetch(leased, NOW, 'other', false)).toBe(true)
  expect(shouldFetch({ ...leased, lease: { by: 'other', at: NOW - LEASE_MS } }, NOW, 'me', false)).toBe(true)
})

test('첫 조회는 토스트하지 않고, 그 뒤에는 처음 보는 알림만 토스트한다', () => {
  const first = applyFetch(emptyCache(), [item({ id: 'a' })], NOW)
  expect(first.fresh).toEqual([])
  expect(first.cache).toMatchObject({ fetchedAt: NOW, okAt: NOW, seenIds: ['a'], lease: null })

  const second = applyFetch(first.cache, [item({ id: 'a' }), item({ id: 'b' })], NOW + 1)
  expect(second.fresh.map(i => i.id)).toEqual(['b'])
  // 읽어서 사라진 알림 id 는 버린다
  expect(applyFetch(second.cache, [item({ id: 'b' })], NOW + 2).cache.seenIds).toEqual(['b'])
})

test('조회가 실패하면 목록을 비우고 본 목록은 남긴다', () => {
  const ok = applyFetch({ ...emptyCache(), okAt: 1, seenIds: ['a'] }, [item({ id: 'a' })], NOW).cache
  const failed = applyFetch({ ...ok, lease: { by: 'me', at: NOW } }, null, NOW + 1)
  expect(failed.fresh).toEqual([])
  expect(failed.cache).toMatchObject({ fetchedAt: NOW + 1, okAt: NOW, notifications: [], seenIds: ['a'], lease: null })
})

test('깨진 캐시 파일은 빈 캐시로 읽는다', () => {
  expect(parseCache('{')).toEqual(emptyCache())
  expect(parseCache('{"fetchedAt":"x","lease":{"by":1}}')).toEqual(emptyCache())
})

test('토스트는 가장 위 알림 하나와 나머지 개수를 보인다', () => {
  const comment = item({ id: 'c', issue: 'ABC-615', title: '리뷰 부탁', type: 'issueNewComment' })
  expect(toastText([comment])).toBe('Linear ABC-615 comment: 리뷰 부탁')
  expect(toastText([item({ id: 'd', category: 'documentChanges', title: '문서' }), comment])).toBe(
    'Linear ABC-615 comment: 리뷰 부탁 and 1 more',
  )
})

test('나를 태그했거나 내 댓글에 답한 알림만 남긴다', () => {
  const kept = onlyForMe([
    item({ id: 'comment-mention', category: 'mentions', type: 'issueCommentMention' }),
    item({ id: 'guessed', type: 'issueCommentMention' }),
    item({ id: 'reply', category: 'commentsAndReplies', type: 'issueNewComment' }),
    item({ id: 'guessed-reply', type: 'issueNewComment' }),
    item({ id: 'gitlab', category: 'statusChanges', type: 'issueStatusChanged' }),
    item({ id: 'reopened', category: 'assignments', type: 'issueReopened' }),
  ])
  expect(kept.map(i => i.id)).toEqual(['comment-mention', 'guessed', 'reply', 'guessed-reply'])
})

test('알림 시각을 3h 처럼 짧게 쓴다', () => {
  expect(formatAgoShort(30_000)).toBe('now')
  expect(formatAgoShort(5 * 60_000)).toBe('5m')
  expect(formatAgoShort(3 * 60 * 60_000 + 59 * 60_000)).toBe('3h')
  expect(formatAgoShort(50 * 60 * 60_000)).toBe('2d')
})
