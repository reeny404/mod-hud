import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { SessionStatus } from '../types'

const NOW = Date.parse('2026-10-13T09:00:00.000Z')
const STATUS = '/home/test/.claude/mod-sessions/self.json'

// 상태 파일은 메모리에 두고, transcript grep 결과는 바꿔 끼울 수 있게 한다
const setup = (on: On) => {
  const files = new Map<string, string>()
  const transcript = { lines: '' }
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
    const argv = (e as unknown as { argv?: string[]; command?: string[] }).argv ?? []
    const isGrepTasks = argv.includes('-F')
    return {
      value: {
        exitCode: 0,
        stdout: isGrepTasks ? transcript.lines : '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/my-app' }))
  on('session.root', () => ({ value: '/p/my-app' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'test' } }) as never)
  on('mcp.call', () => {
    throw new Error('not connected')
  })
  on('session.start', ($, e) => e as never)
  on('prompt.submit', ($, e) => e as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { status: 'async_launched', agentId: 'a701' } }) as never)
  const status = () => JSON.parse(files.get(STATUS) ?? 'null') as SessionStatus | null
  return { transcript, status }
}

const turn = (answer: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }) as never

const launchAgent = ($: { tool: { call: (e: never) => Promise<unknown> } }) =>
  $.tool.call({ tool: 'Agent', id: 'toolu_1', input: { prompt: 'x', run_in_background: true } } as never)

test('턴 도중 queued 로 붙은 완료 알림은 턴이 끝날 때 transcript 에서 찾아 진행 중에 두지 않는다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { transcript, status } = setup(on)
  await $.session.start({ source: 'startup', cwd: '/p/my-app' } as never)
  await $.prompt.submit({ text: '리뷰 맡겨줘' } as never)
  await launchAgent($ as never)
  expect(status()?.background?.map(task => task.id)).toEqual(['a701'])

  transcript.lines = String.raw`{"attachment":{"type":"queued_command","prompt":"<task-notification>\n<task-id>a701</task-id>\n<status>completed</status>\n</task-notification>"}}`
  await $.turn.complete(turn('리뷰 끝났습니다.'))

  expect(status()?.state).toBe('waiting')
  expect(status()?.attention?.kind).toBe('answered')
  expect(status()?.background).toEqual([])
})

test('백그라운드 작업만 기다리던 세션은 작업이 끝나면 heartbeat 가 내 차례로 넘긴다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { transcript, status } = setup(on)
  await $.session.start({ source: 'startup', cwd: '/p/my-app' } as never)
  await $.prompt.submit({ text: '리뷰 맡겨줘' } as never)
  await launchAgent($ as never)
  await $.turn.complete(turn('맡겼습니다.'))
  expect(status()?.state).toBe('working')
  expect(status()?.waitingOnTasks).toBe(true)

  await clock.advance(61 * 1000)
  expect(status()?.state).toBe('working')

  // 결과가 <agent-message> 로만 왔고 prompt.submit 은 그 알림을 보지 못했다
  transcript.lines = String.raw`{"content":"<agent-message from=\"a701\">\n[Subagent hand-back] 보고서"}`
  await clock.advance(61 * 1000)
  expect(status()?.state).toBe('waiting')
  expect(status()?.attention?.kind).toBe('answered')
  expect(status()?.background).toEqual([])
})

test('알림을 끝내 못 찾아도 1시간 지난 작업은 heartbeat 가 지운다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { status } = setup(on)
  await $.session.start({ source: 'startup', cwd: '/p/my-app' } as never)
  await $.prompt.submit({ text: '리뷰 맡겨줘' } as never)
  await launchAgent($ as never)
  await $.turn.complete(turn('맡겼습니다.'))
  expect(status()?.state).toBe('working')

  await clock.advance(61 * 60 * 1000)
  expect(status()?.state).toBe('waiting')
  expect(status()?.background).toEqual([])
})
