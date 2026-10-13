import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-12T06:00:00.000Z')

// 상태 파일은 메모리에 두고, 보낸 OS 알림만 모은다
const setup = (on: On) => {
  const sent: Array<{ text: string; title?: string }> = []
  const files = new Map<string, string>()
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
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'feat/#ABC-614-x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/my-app' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('mcp.call', () => {
    throw new Error('not connected')
  })
  on('ui.notify', ($, e) => {
    sent.push(e as unknown as { text: string; title?: string })
    return { value: { isSent: true, channel: 'test' } } as never
  })
  on('session.start', ($, e) => e as never)
  on('prompt.submit', ($, e) => e as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return sent
}

const turn = (answer: string) =>
  ({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' }) as never

test('질문으로 끝난 턴은 1분 동안 답이 없을 때만 이슈 번호와 함께 OS 알림을 보낸다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent = setup(on)
  await $.session.start({ source: 'startup', cwd: '/p/my-app' } as never)

  await $.turn.complete(turn('정리했습니다.\n추가할까요?'))
  await clock.advance(30 * 1000)
  expect(sent).toEqual([])
  await clock.advance(31 * 1000)
  expect(sent.map(one => one.text)).toEqual(['ABC-614 질문: 추가할까요?'])
})

test('1분 안에 답하면 알리지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sent = setup(on)
  await $.session.start({ source: 'startup', cwd: '/p/my-app' } as never)

  await $.turn.complete(turn('추가할까요?'))
  await clock.advance(20 * 1000)
  await $.prompt.submit({ text: '응' } as never)
  await clock.advance(2 * 60 * 1000)
  expect(sent).toEqual([])
})
