import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { IssuesCache, Row } from '../types'
import { issuesFileOf, ISSUES_TTL_MS } from './issues-lib'

const NOW = Date.parse('2026-10-12T06:00:00.000Z')
const FILE = `/home/test/.claude/${issuesFileOf('/r/my-app')}`

const ROW: Row = {
  path: '/r/my-app/.claude/worktrees/wind',
  head: 'bbb',
  branch: 'feat/ABC-611-wind',
  isMain: false,
  issue: 'ABC-611',
  ahead: 1,
  dirty: 0,
  session: null,
  mr: null,
  linear: null,
  note: null,
}

// 파일은 메모리에 두고, git worktree list 를 몇 번 불렀는지 센다
const setup = (on: On, files: Map<string, string>) => {
  const calls = { worktreeList: 0 }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: false }))
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
    if (argv[1] === 'worktree' && argv[2] === 'list') {
      calls.worktreeList += 1
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/r/my-app' }))
  on('session.repo', () => ({ value: { root: '/r/my-app', remote: 'git@host:acme/dev/team/app.git' } }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('mcp.call', () => {
    throw new Error('not connected')
  })
  on('session.start', ($, e) => e as never)
  return calls
}

const cache = (patch: Partial<IssuesCache>): string =>
  JSON.stringify({ fetchedAt: NOW, rows: [ROW], branchMrs: {}, log: [], lease: null, ...patch })

test('다른 세션이 2분 안에 조회했으면 git 을 부르지 않고 파일의 목록을 보인다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map([[FILE, cache({ fetchedAt: NOW - 60 * 1000 })]])
  const calls = setup(on, files)

  await $.session.start({ source: 'startup', cwd: '/r/my-app' } as never)
  await clock.advance(1000)
  expect(calls.worktreeList).toBe(0)

  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props: {} as never } as never)
  expect(await pane.find({ type: 'Text', text: /#ABC-611/ })).toBeDefined()
  await pane.unmount()
})

test('파일이 오래됐으면 한 번만 조회하고, 다른 세션이 맡고 있으면 기다린다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map([[FILE, cache({ fetchedAt: NOW - ISSUES_TTL_MS - 1 })]])
  const calls = setup(on, files)

  await $.session.start({ source: 'startup', cwd: '/r/my-app' } as never)
  await clock.advance(1000)
  expect(calls.worktreeList).toBe(1)
  const written = JSON.parse(files.get(FILE) ?? '{}') as IssuesCache
  expect(written.lease).toBeNull()
  expect(written.fetchedAt).toBeGreaterThanOrEqual(NOW)

  // 주기가 다시 지났어도 다른 세션이 막 맡았으면 부르지 않는다
  files.set(FILE, cache({ fetchedAt: NOW - ISSUES_TTL_MS, lease: { by: 'other', at: NOW + ISSUES_TTL_MS } }))
  await clock.advance(ISSUES_TTL_MS)
  expect(calls.worktreeList).toBe(1)
})
