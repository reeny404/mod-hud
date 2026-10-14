import { expect, mock, test } from 'claude-code/testing'

import type { SessionStatus } from '../types'

const NOW = 1_000_000

const base = {
  cwd: '/p/momochi',
  root: '/p/momochi',
  project: 'momochi',
  branch: 'main',
  updatedAt: NOW,
  todos: null,
}

// 하나는 일하고, 하나는 질문을 남기고 나를 기다린다
const SESSIONS: SessionStatus[] = [
  {
    ...base,
    id: 'm1',
    state: 'working',
    prompt: '남은 작업 정리해줘',
    workingSince: NOW - 5 * 60_000,
    todos: { done: 3, total: 7, current: '마이그레이션 적용 중' },
  },
  {
    ...base,
    id: 'm2',
    state: 'waiting',
    prompt: '스키마 바꿔줘',
    attention: { kind: 'question', since: NOW - 12 * 60_000, text: '컬럼 이름을 바꿀까요?' },
  },
]

test('입력창 위 한 줄과 패널이 상태 파일을 읽어 각 화면에서 그려진다', async ($, on) => {
  mock.clock(on, { now: NOW })
  // 플러그인 아래에서 엔진 대신 답해 상태 폴더에 momochi 세션 하나만 있게 한다
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({
    value: SESSIONS.map(one => ({ name: `${one.id}.json`, kind: 'file', size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    const found = SESSIONS.find(one => path.endsWith(`/${one.id}.json`))
    if (!found) {
      throw new Error('ENOENT')
    }
    return { value: JSON.stringify(found) }
  })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/my-app' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', ($, e) => e as never)

  await $.session.start({ source: 'startup', cwd: '/p/my-app' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: 'Text', text: /⚑ Your turn 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ Working 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /MR/ })).toBeUndefined()
    // 내 차례 세션은 입력창 위에 한 줄씩 풀어 보인다
    expect(await ui.find({ type: 'Text', text: /\? question/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /› 컬럼 이름을 바꿀까요\?/ })).toBeDefined()
    await ui.unmount()

    // 저장소 정보가 없는 세션에서는 Issues 가 없다
    const pane = await $.ui.mount({ plugin: 'mod-hud', surface, component: 'Pane', requestId: 'mod-hud', props: {} as never } as never)
    expect(await pane.find({ type: 'Text', text: /⚑ Your turn 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\? question/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /for 12m/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /컬럼 이름을 바꿀까요\?/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /▶ Working 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /마이그레이션 적용 중/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Issues/ })).toBeUndefined()
    await pane.unmount()
  }
})
