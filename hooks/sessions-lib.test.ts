import { expect, test } from 'claude-code/testing'

import type { SessionStatus } from '../types'
import {
  applyTaskUpdate,
  attentionAfterTurn,
  BACKGROUND_MAX_MS,
  finishedTaskIds,
  firstLine,
  freshness,
  isCodeReviewSession,
  isQuestion,
  launchedTaskId,
  pendingTasks,
  pickTitle,
  transcriptPathOf,
  KEEP_MS,
  STALE_MS,
  summarizeTodos,
  triage,
} from './sessions-lib'

const NOW = 10 * 24 * 60 * 60 * 1000

const session = (patch: Partial<SessionStatus>): SessionStatus => ({
  id: 'a',
  cwd: '/p/momochi',
  root: '/p/momochi',
  project: 'momochi',
  branch: 'main',
  state: 'waiting',
  updatedAt: NOW,
  prompt: null,
  todos: null,
  ...patch,
})

test('요청은 비어 있지 않은 첫 줄만 짧게 남긴다', () => {
  expect(firstLine('\n  남은 작업 정리해줘\n두 번째 줄')).toBe('남은 작업 정리해줘')
  expect(firstLine('   ')).toBeNull()
  expect(firstLine('가'.repeat(70))).toBe(`${'가'.repeat(60)}…`)
})

test('할 일 목록은 완료 수와 진행 중 항목으로 줄인다', () => {
  expect(summarizeTodos([])).toBeNull()
  expect(
    summarizeTodos([
      { id: '0', label: '스키마', status: 'completed' },
      { id: '1', label: '마이그레이션 적용 중', status: 'in_progress' },
      { id: '2', label: 'API', status: 'pending' },
    ]),
  ).toEqual({ done: 1, total: 3, current: '마이그레이션 적용 중' })
})

test('TaskUpdate 는 한 항목의 상태와 이름을 바꾸고 deleted 면 뺀다', () => {
  const items = [
    { id: '1', label: 'A', status: 'pending' as const },
    { id: '2', label: 'B', status: 'pending' as const },
  ]
  expect(applyTaskUpdate(items, '1', { status: 'in_progress', label: 'A2' })[0]).toEqual({
    id: '1',
    label: 'A2',
    status: 'in_progress',
  })
  expect(applyTaskUpdate(items, '2', { status: 'deleted' }).map(i => i.id)).toEqual(['1'])
})

test('마지막 줄이 물음표로 끝나면 질문으로 본다', () => {
  expect(isQuestion('정리했습니다.\n\n전역 권한 설정이라 바로 넣지 않았습니다. **추가할까요?**')).toBe(true)
  expect(isQuestion('왜 그런가? 원인은 이렇다.\n고쳤습니다.')).toBe(false)
  expect(attentionAfterTurn('넣을까요?', false, NOW)).toEqual({ kind: 'question', since: NOW, text: '넣을까요?' })
  expect(attentionAfterTurn('끝났습니다.', false, NOW)).toEqual({ kind: 'answered', since: NOW, text: null })
  expect(attentionAfterTurn('넣을까요?', true, NOW)).toBeNull()
})

test('나를 기다리는 세션을 막힌 정도와 오래 기다린 순서로 위에 둔다', () => {
  const board = triage(
    [
      session({ id: 'done-old', attention: { kind: 'answered', since: NOW - 60_000, text: null } }),
      session({ id: 'ask', attention: { kind: 'question', since: NOW - 1000, text: '어느 쪽?' } }),
      session({ id: 'perm', state: 'working', attention: { kind: 'permission', since: NOW, text: 'Bash' } }),
      // 질문 도구는 턴 도중에 뜨므로 작업 중 상태로 온다
      session({ id: 'ask-tool', state: 'working', attention: { kind: 'question', since: NOW, text: '어느 이슈?' } }),
      session({ id: 'done-new', attention: { kind: 'answered', since: NOW, text: null } }),
      session({ id: 'run-new', state: 'working', workingSince: NOW - 1000 }),
      session({ id: 'run-old', state: 'working', workingSince: NOW - 9000 }),
      session({ id: 'empty', waitingSince: NOW - 4 * 60 * 60_000 }),
      session({ id: 'self', attention: { kind: 'answered', since: NOW, text: null } }),
    ],
    'self',
    NOW,
  )
  expect(board.mine.map(e => e.id)).toEqual(['perm', 'ask', 'ask-tool', 'done-old', 'done-new'])
  expect(board.running.map(e => e.id)).toEqual(['run-old', 'run-new'])
  expect(board.idle.map(e => [e.id, e.label, e.since])).toEqual([['empty', 'momochi main', NOW - 4 * 60 * 60_000]])
  expect(board.hidden).toEqual({ stale: 0, ended: 0 })
})

test('끊긴 세션과 끝난 세션은 숨기고 개수만 센다', () => {
  const board = triage(
    [
      session({ id: 'stale', state: 'working', updatedAt: NOW - STALE_MS - 1 }),
      session({ id: 'ended', state: 'ended' }),
      session({ id: 'old', state: 'ended', updatedAt: NOW - KEEP_MS - 1 }),
    ],
    null,
    NOW,
  )
  expect(board.mine).toEqual([])
  expect(board.running).toEqual([])
  expect(board.idle).toEqual([])
  expect(board.hidden).toEqual({ stale: 1, ended: 1 })
})

test('브랜치에 이슈 번호가 있으면 그것으로, 프로젝트가 여럿이면 프로젝트를 앞에 붙인다', () => {
  const one = triage([session({ id: 'a', state: 'working', branch: 'feat/#ABC-618-x', root: '/p/my-app', project: 'my-app' })], null, NOW)
  expect(one.running[0]?.label).toBe('ABC-618')
  const many = triage(
    [
      session({ id: 'a', state: 'working', branch: 'feat/#ABC-618-x', root: '/p/my-app', project: 'my-app' }),
      session({ id: 'b', state: 'working' }),
    ],
    null,
    NOW,
  )
  expect(many.running.map(e => e.label)).toEqual(['my-app ABC-618', 'momochi main'])
})

test('MR 이 머지된 브랜치에서 답을 끝낸 세션은 내 차례에서 빈 대기로 옮긴다', () => {
  const done = session({ id: 'done', branch: 'chore/x', attention: { kind: 'answered', since: NOW - 7 * 60_000, text: null } })
  const asking = session({ id: 'ask', branch: 'chore/x', attention: { kind: 'question', since: NOW, text: '어느 쪽?' } })
  const board = triage([done, asking], null, NOW, new Set(['chore/x']))
  // 질문은 머지와 상관없이 답해야 한다
  expect(board.mine.map(e => e.id)).toEqual(['ask'])
  expect(board.idle.map(e => [e.id, e.since])).toEqual([['done', NOW - 7 * 60_000]])
})

test('/resume 목록의 이름을 transcript 에서 고른다', () => {
  const lines = [
    '{"type":"ai-title","aiTitle":"처음 제목","sessionId":"x"}',
    '{"type":"ai-title","aiTitle":"바뀐 제목","sessionId":"x"}',
  ].join('\n')
  expect(pickTitle(lines)).toBe('바뀐 제목')
  expect(pickTitle(`${lines}\n{"type":"custom-title","customTitle":"내가 지은 이름"}\n{"type":"ai-title","aiTitle":"더 나중 제목"}`)).toBe(
    '내가 지은 이름',
  )
  expect(pickTitle('{"type":"ai-ti')).toBeNull()
  expect(transcriptPathOf('/home/me', '/Users/me/projects/my-app', 'abc')).toBe(
    '/home/me/.claude/projects/-Users-me-projects-my-app/abc.jsonl',
  )
})

test('조회한 지 얼마나 됐고 다음 조회가 언제인지 보인다', () => {
  const TTL = 15 * 60_000
  expect(freshness(null, TTL, NOW)).toBe('아직 조회 전')
  expect(freshness(NOW - 6 * 60_000, TTL, NOW)).toBe('6분 전 조회, 9분 뒤 다시')
  expect(freshness(NOW - 10_000, 2 * 60_000, NOW)).toBe('방금 조회, 2분 뒤 다시')
  expect(freshness(NOW - TTL - 1, TTL, NOW)).toBe('15분 전 조회, 곧 다시')
})

test('백그라운드 Bash 와 Agent 결과에서 띄운 작업 id 를 뽑는다', () => {
  expect(launchedTaskId({ stdout: '', backgroundTaskId: 'bfstx9vzz' })).toBe('bfstx9vzz')
  expect(launchedTaskId({ status: 'async_launched', agentId: 'ab1d' })).toBe('ab1d')
  expect(launchedTaskId({ status: 'completed', agentId: 'ab1d' })).toBeNull()
  expect(launchedTaskId({ stdout: 'ok' })).toBeNull()
  expect(launchedTaskId(undefined)).toBeNull()
})

test('끝났다는 알림의 작업 id 만 뽑는다', () => {
  const done = '<task-notification>\n<task-id>bfstx9vzz</task-id>\n<status>completed</status>\n</task-notification>'
  const failed = '<task-notification><task-id>b2</task-id><status>failed</status></task-notification>'
  const running = '<task-notification><task-id>b3</task-id><status>running</status></task-notification>'
  expect(finishedTaskIds(`${done}\n${failed}\n${running}`)).toEqual(['bfstx9vzz', 'b2'])
  expect(finishedTaskIds('push 끝났어?')).toEqual([])
})

test('서브에이전트가 결과를 돌려준 메시지도 끝난 것으로 본다', () => {
  const prompt = 'Another Claude session sent a message: <agent-message from="a701">\n[Subagent hand-back] 보고서'
  // transcript 줄에서는 JSON 문자열이라 따옴표와 줄바꿈이 escape 돼 있다
  const line = String.raw`{"content":"<agent-message from=\"a0fd\">\n[Subagent hand-back] 보고서"}`
  const chat = '<agent-message from="peer">안녕</agent-message>'
  expect(finishedTaskIds(prompt)).toEqual(['a701'])
  expect(finishedTaskIds(line)).toEqual(['a0fd'])
  expect(finishedTaskIds(chat)).toEqual([])
})

test('끝난 작업과 너무 오래된 작업은 진행 중에서 뺀다', () => {
  const tasks = [
    { id: 'a', at: NOW - 1000 },
    { id: 'b', at: NOW - 1000 },
    { id: 'old', at: NOW - BACKGROUND_MAX_MS },
  ]
  expect(pendingTasks(tasks, NOW, ['a']).map(task => task.id)).toEqual(['b'])
})

test('iTerm2 Code Review 탭이 띄운 세션은 목록에서 빼고 개수에도 넣지 않는다', () => {
  const review = 'Review the pending changes in this repo. Flag issues a caref…'
  const board = triage(
    [
      session({ id: 'r', state: 'working', prompt: review }),
      session({ id: 's', state: 'waiting', prompt: '다른 요청', isCodeReview: true }),
      session({ id: 'w', state: 'working', prompt: '일해줘' }),
    ],
    null,
    NOW,
  )
  expect(board.running.map(entry => entry.id)).toEqual(['w'])
  expect([...board.mine, ...board.idle]).toEqual([])
  expect(isCodeReviewSession({ prompt: '이 repo 리뷰해줘' })).toBe(false)
})
