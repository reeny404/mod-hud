import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { InboxCache } from '../types'
import { INBOX_TTL_MS } from './inbox-lib'

const NOW = Date.parse('2026-10-12T06:00:00.000Z')
const FILE = '/home/test/.claude/mod-inbox.json'

const notification = (id: string, title: string) => ({
  id,
  type: 'issueCommentMention',
  category: 'mentions',
  title,
  subtitle: 'Kim mentioned you',
  url: `https://linear.app/w/issue/ABC-${id}/x`,
  createdAt: '2026-10-12T05:50:00.000Z',
})

// 상태 파일과 공유 캐시 파일을 메모리에 두고 Linear 호출과 토스트를 센다
const setup = (on: On, files: Map<string, string>, isLinearDown = false) => {
  const calls = { linear: 0, toasts: [] as string[], opened: [] as string[] }
  // GitLab 이 바꾼 상태 알림은 패널과 토스트에 나오지 않아야 한다
  const gitlab = { ...notification('999', '상태 변경'), type: 'issueStatusChanged', category: 'statusChanges' }
  let notifications = [notification('615', '리뷰 부탁')]
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const text = files.get((e as unknown as { path: string }).path)
    if (text === undefined) {
      throw new Error('ENOENT')
    }
    return { value: text }
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    files.set(path, text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = (e as unknown as { argv: string[] }).argv
    if (argv[0] === 'open' && argv[1]) {
      calls.opened.push(argv[1])
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/x' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', ($, e) => {
    calls.toasts.push((e as unknown as { text: string }).text)
    return { value: undefined }
  })
  on('mcp.call', ($, e) => {
    if (isLinearDown) {
      throw new Error('not connected')
    }
    expect(e).toMatchObject({ server: 'claude.ai Linear', tool: 'get_notifications', args: { unreadOnly: true, limit: 250 } })
    calls.linear += 1
    return { value: { content: [{ type: 'text', text: JSON.stringify({ notifications: [...notifications, gitlab] }) }], isError: false } } as never
  })
  on('session.start', ($, e) => e as never)
  return { calls, setNotifications: (next: typeof notifications) => (notifications = next) }
}

const cacheOf = (files: Map<string, string>) => JSON.parse(files.get(FILE) ?? '{}') as InboxCache

test('처음에는 한 번 부르고 토스트 없이 쌓인 알림을 보이며, 15분 뒤 새 알림만 한 번 토스트한다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map<string, string>()
  const { calls, setNotifications } = setup(on, files)

  await $.session.start({ source: 'startup', cwd: '/p/x' } as never)
  await clock.advance(1000)
  expect(calls.linear).toBe(1)
  expect(calls.toasts).toEqual([])
  expect(cacheOf(files).seenIds).toEqual(['615'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await band.find({ type: 'Text', text: /@ Linear 1/ })).toBeDefined()
    await band.unmount()
    const pane = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: 'mod-hud', props: {} as never } as never)
    expect(await pane.find({ type: 'Text', text: /^@ Linear Inbox \(1\)$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /ABC-615/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^\s*리뷰 부탁$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /› Kim mentioned you$/ })).toBeDefined()
    // 멘션을 누르면 그 알림의 이슈 페이지를 연다
    await pane.press({ key: 'inbox-615' })
    expect(calls.opened.at(-1)).toBe('https://linear.app/w/issue/ABC-615/x')
    await pane.unmount()
  }

  // 15분이 지나기 전에는 매분 파일만 읽는다
  setNotifications([notification('615', '리뷰 부탁'), notification('700', '새 댓글')])
  await clock.advance(INBOX_TTL_MS - 2 * 60 * 1000)
  expect(calls.linear).toBe(1)
  await clock.advance(3 * 60 * 1000)
  expect(calls.linear).toBe(2)
  expect(calls.toasts).toEqual(['Linear ABC-700 멘션: 새 댓글'])
})

test('다른 세션이 막 조회했거나 조회 중이면 Linear 를 부르지 않고 토스트도 하지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const fresh: InboxCache = {
    fetchedAt: NOW - 60 * 1000,
    okAt: NOW - 60 * 1000,
    notifications: [{ id: 'n', type: 'issueMention', category: 'mentions', title: '멘션', subtitle: null, url: null, issue: 'ABC-1', createdAt: NOW }],
    seenIds: [],
    lease: null,
  }
  const files = new Map([[FILE, JSON.stringify(fresh)]])
  const { calls } = setup(on, files)

  await $.session.start({ source: 'startup', cwd: '/p/x' } as never)
  await clock.advance(1000)
  expect(calls.linear).toBe(0)
  expect(calls.toasts).toEqual([])
  const band = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } as never })
  expect(await band.find({ type: 'Text', text: /@ Linear 1/ })).toBeDefined()
  await band.unmount()

  // 캐시가 오래됐어도 다른 세션이 맡은 조회가 살아 있으면 기다린다
  files.set(FILE, JSON.stringify({ ...fresh, fetchedAt: NOW - INBOX_TTL_MS, lease: { by: 'other', at: NOW + 60 * 1000 } }))
  await clock.advance(60 * 1000)
  expect(calls.linear).toBe(0)
})

test('Linear 가 실패하면 섹션과 한 줄을 비운다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map<string, string>()
  setup(on, files, true)

  await $.session.start({ source: 'startup', cwd: '/p/x' } as never)
  await clock.advance(1000)
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props: {} as never } as never)
  expect(await pane.find({ type: 'Text', text: /Linear Inbox/ })).toBeUndefined()
  await pane.unmount()
  expect(cacheOf(files).okAt).toBeNull()
})
