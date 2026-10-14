import { expect, mock, test } from 'claude-code/testing'

import type { SessionStatus } from '../types'

test('/clear 뒤 새 세션은 이전 세션의 ended 와 프롬프트를 물려받지 않는다', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  let id = 'old'
  const written = new Map<string, SessionStatus>()
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: true }))
  let lists = 0
  on('fs.list', () => {
    lists += 1
    return { value: [] }
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    written.set(path, JSON.parse(text))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: id }))
  on('session.cwd', () => ({ value: '/p/x' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', ($, e) => e as never)
  on('prompt.submit', ($, e) => e as never)
  on('classic.SessionStart', () => ({}) as never)
  on('session.end', ($, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)

  await $.session.start({ source: 'startup', cwd: '/p/x' } as never)
  await $.prompt.submit({ text: '이전 작업' } as never)
  await $.session.end({ reason: 'clear', sessionId: 'old' } as never)
  expect(written.get('/home/test/.claude/mod-sessions/old.json')?.state).toBe('ended')

  // /clear 뒤 엔진은 새 id 로 계속 가고 session.start 대신 classic SessionStart(clear) 만 온다
  id = 'new'
  const listsBefore = lists
  await $.classic.SessionStart({ source: 'clear' } as never)

  // 다음 heartbeat 나 새로고침 주기를 기다리지 않고 곧바로 새 세션을 쓰고 목록을 다시 읽는다
  expect(lists).toBeGreaterThan(listsBefore)

  const next = written.get('/home/test/.claude/mod-sessions/new.json')
  expect(next?.state).toBe('waiting')
  expect(next?.prompt).toBeNull()
  expect(next?.predecessor).toBe('old')
  // 브랜치가 없는 세션은 MR 이 없다고 바로 적어 알을 받을 수 있다
  expect(next?.branch).toBeNull()
  expect(next?.mrBranch).toBeNull()
  expect(next?.mrState).toBeNull()
})

test('classic SessionStart 가 오지 않아도 /clear 뒤 처음 쓰는 상태에 이전 세션을 적는다', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  let id = 'old'
  const written = new Map<string, SessionStatus>()
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [] }))
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    written.set(path, JSON.parse(text))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: id }))
  on('session.cwd', () => ({ value: '/p/x' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', ($, e) => e as never)
  on('prompt.submit', ($, e) => e as never)
  on('session.end', ($, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)

  await $.session.start({ source: 'startup', cwd: '/p/x' } as never)
  await $.prompt.submit({ text: '이전 작업' } as never)
  await $.session.end({ reason: 'clear', sessionId: 'old' } as never)

  id = 'new'
  await $.prompt.submit({ text: '새 작업' } as never)
  expect(written.get('/home/test/.claude/mod-sessions/new.json')?.predecessor).toBe('old')
  // 이어 받은 뒤 다시 쓸 때도 남는다
  await $.prompt.submit({ text: '또 다른 작업' } as never)
  expect(written.get('/home/test/.claude/mod-sessions/new.json')?.predecessor).toBe('old')
})
