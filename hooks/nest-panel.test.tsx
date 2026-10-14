import { expect, mock, test } from 'claude-code/testing'

import type { BoxEntry, Pokedex } from '../types'
import { emptyPokedex } from './nest-lib'

const NOW = 1_000_000

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

// 그려진 트리에서 type 이 같고 props 가 모두 맞는 요소를 찾는다
function nodes(tree: unknown, type: string, props: Record<string, unknown> = {}): Node[] {
  const found: Node[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return
    }
    const one = node as Node
    if (one.type === type && Object.entries(props).every(([k, v]) => one.props?.[k] === v)) {
      found.push(one)
    }
    for (const child of one.children ?? []) {
      walk(child)
    }
  }
  walk(tree)
  return found
}

const entry = (key: string, species: number, at: number): BoxEntry => ({ key, species, root: '/p/a', branch: null, label: key, at })

test('옆에 붙은 패널은 PC BOX 머리줄에 앞장선 포켓몬과 경험치를 보이고 칸마다 그림을 그린다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1), entry('b', 6, 2), entry('c', 16, 3)], lead: 'a', xp: 0 }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 19: 'Rattata', 20: 'Raticate', 6: 'Charizard', 16: 'Pidgey', 17: 'Pidgeotto' }) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ok: false, status: 404, text: '' } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/a' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.blit', () => ({ value: { deny: false } }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/p/a' } as never)

  const props = { placement: 'dock', bodyColumns: 60, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  expect(await pane.find({ type: 'Text', text: /PC BOX/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /★ Rattata ░░░░░ 3h0m/ })).toBeDefined()
  // 폭 60 은 한 줄에 세 칸이고, 빈 칸도 벽으로 그린다
  expect(nodes(await pane.drawn(), 'Raster', { key: 'tile-2' }).length).toBe(1)
  expect(nodes(await pane.drawn(), 'Raster', { key: 'tile-3' }).length).toBe(0)
  // 진화할 수 있는 포켓몬이 있으면 앞장을 고르는 버튼이 있다
  expect(nodes(await pane.drawn(), 'Button', { label: 'Lead ▶' }).length).toBe(1)
  // 칸마다 마우스를 올리면 뜨는 카드가 있다. 진화할 수 있고 앞장이 아닌 포켓몬에만 앞장세우기 버튼이 있다
  expect(await pane.find({ type: 'Text', text: /→ Raticate/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /→ Pidgeotto/ })).toBeDefined()
  const tree = await pane.drawn()
  expect(nodes(tree, 'Button', { key: 'lead-c' }).length).toBe(1)
  expect(nodes(tree, 'Button', { key: 'lead-a' }).length).toBe(0)
  expect(nodes(tree, 'Button', { key: 'lead-b' }).length).toBe(0)
  // 카드는 패널 안에 들어가게 놓는다. 폭 60, 칸 20 이면 칸은 0, 20, 40 에 있고 카드 폭은 42 다
  expect(nodes(tree, 'Box', { backgroundColor: '#202020' }).map(card => card.props?.left)).toEqual([0, -11, -22])
  // 카드는 아래 화면이 비치지 않게 배경을 칠하고 가운데 정렬한다
  expect(nodes(tree, 'Box', { backgroundColor: '#202020', alignItems: 'center' }).length).toBe(3)
  await pane.unmount()
})

test('다른 세션이 조금 전에 적은 진화도 이 패널이 처음 보면 그 칸의 페이지로 넘겨 보인다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1), entry('b', 6, 2), entry('c', 16, 3), entry('d', 20, 4)], lead: 'a', xp: 0, evolving: { key: 'd', from: 19, at: NOW - 20_000 } }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 19: 'Rattata', 20: 'Raticate', 6: 'Charizard', 16: 'Pidgey', 17: 'Pidgeotto' }) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ok: false, status: 404, text: '' } }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/a' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.blit', () => ({ value: { deny: false } }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/p/a' } as never)

  const props = { placement: 'dock', bodyColumns: 60, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  // 기록을 쓰는 세션이 20초 전에 적은 진화라도 이 패널은 처음 보므로 넘겨서 깜빡인다
  expect(await pane.find({ type: 'Text', text: /PC BOX  2\/2/ })).toBeDefined()
  await pane.unmount()
})
