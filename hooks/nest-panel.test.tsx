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

// 요소 안의 글자를 모두 이어 붙인다
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  const one = node as Node | null
  return (one?.children ?? []).map(textOf).join('')
}

const entry = (key: string, species: number, at: number): BoxEntry => ({ key, species, root: '/p/a', branch: null, label: key, at })

test('옆에 붙은 패널은 DAY CARE 머리줄에 맡긴 포켓몬과 경험치를 보이고 PC BOX 를 칸마다 그린다', async ($, on) => {
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
  // 키우미집에 맡겨 키우는 포켓몬과 경험치는 DAY CARE 머리줄에 보이고 PC BOX 머리줄에는 없다
  const header = (key: string) => nodes(tree0(), 'Button', { key }).map(textOf).join('')
  let drawnNow = await pane.drawn()
  const tree0 = () => drawnNow
  expect(header('daycare-toggle')).toContain('★ Rattata ░░░░░ 3h0m')
  expect(header('box-toggle')).not.toContain('Rattata')
  // 폭 60 은 한 줄에 세 칸이고, 빈 칸도 벽으로 그린다
  expect(nodes(await pane.drawn(), 'Raster', { key: 'tile-2' }).length).toBe(1)
  expect(nodes(await pane.drawn(), 'Raster', { key: 'tile-3' }).length).toBe(0)
  // 키우미집에 맡길 포켓몬은 마우스 카드의 Leave at DAY CARE 로만 고르고, 박스 아래 앞장 버튼은 없다
  expect(nodes(await pane.drawn(), 'Button', { label: 'Lead ▶' }).length).toBe(0)
  expect(nodes(await pane.drawn(), 'Button', { label: '◀ Lead' }).length).toBe(0)
  // 칸마다 마우스를 올리면 뜨는 카드가 있다. 진화할 수 있고 앞장이 아닌 포켓몬에만 앞장세우기 버튼이 있다
  // 카드에는 다음 진화를 미리 보이지 않는다
  expect(await pane.find({ type: 'Text', text: /→/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Raticate|Pidgeotto/ })).toBeUndefined()
  const tree = await pane.drawn()
  expect(nodes(tree, 'Button', { key: 'lead-c', label: 'Leave at DAY CARE' }).length).toBe(1)
  // Leave at DAY CARE 버튼도 카드 가운데에 놓는다
  const centered = nodes(tree, 'Box', { justifyContent: 'center', width: '100%' })
  expect(centered.some(box => nodes(box, 'Button', { key: 'lead-c' }).length === 1)).toBe(true)
  expect(nodes(tree, 'Button', { key: 'lead-a' }).length).toBe(0)
  expect(nodes(tree, 'Button', { key: 'lead-b' }).length).toBe(0)
  // 카드는 패널 안에 들어가게 놓는다. 폭 60, 칸 16 이면 세 칸이 가운데 정렬돼 6, 22, 38 에 있고 카드 폭은 42 다
  expect(nodes(tree, 'Box', { backgroundColor: '#202020' }).map(card => card.props?.left)).toEqual([-6, -13, -20])
  // 카드는 아래 화면이 비치지 않게 배경을 칠하고 가운데 정렬한다
  expect(nodes(tree, 'Box', { backgroundColor: '#202020', alignItems: 'center' }).length).toBe(3)
  // DAY CARE 머리줄을 누르면 풀밭을 접고 남은 알 수만 남긴다. 다시 누르면 편다
  // 앞장선 포켓몬이 걸을 수 있게 풀밭이 높아진다
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare', rows: 6 }).length).toBe(1)
  await pane.press({ key: 'daycare-toggle' })
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare' }).length).toBe(0)
  // 접어도 머리줄의 남은 알 수와 맡긴 포켓몬의 경험치는 남는다
  drawnNow = await pane.drawn()
  expect(header('daycare-toggle')).toContain('★ Rattata ░░░░░ 3h0m')
  await pane.press({ key: 'daycare-toggle' })
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare' }).length).toBe(1)
  // PC BOX 머리줄을 누르면 박스를 접는다. 다시 누르면 편다
  await pane.press({ key: 'box-toggle' })
  expect(nodes(await pane.drawn(), 'Raster', { key: 'tile-0' }).length).toBe(0)
  await pane.press({ key: 'box-toggle' })
  expect(nodes(await pane.drawn(), 'Raster', { key: 'tile-0' }).length).toBe(1)
  await pane.unmount()
})

test('최종 진화형이 맡겨져 있으면 MAX 로 보이고 Take back 버튼이 있으며, 야생 전설은 등장 장면과 함께 몬스터볼과 Run 버튼으로 남는다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('legend:146', 146, 0), entry('a', 19, 1), entry('b', 6, 2)], lead: 'b', chosen: true, xp: 0, encounter: { species: 145, at: NOW - 3000, root: '/p/a', branch: null, label: 'b' }, scene: { kind: 'appear', species: 145, at: NOW - 3000 }, fled: { species: 144 } }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 19: 'Rattata', 6: 'Charizard', 146: 'Moltres', 145: 'Zapdos', 144: 'Articuno' }) }
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
  const tree = await pane.drawn()
  expect(nodes(tree, 'Button', { key: 'daycare-toggle' }).map(textOf).join('')).toContain('★ Charizard MAX')
  expect(nodes(tree, 'Button', { key: 'takeback-b', label: 'Take back' }).length).toBe(1)
  expect(nodes(tree, 'Button', { key: 'lead-a' }).length).toBe(1)
  // 막 나타난 전설은 알과 DAY CARE 위에 등장 장면을 겹쳐 띄운다
  expect(nodes(tree, 'Raster', { key: 'arrival' }).length).toBe(1)
  // 장면 뒤에도 야생 전설이 몬스터볼과 Run 버튼과 함께 남는다
  expect(await pane.find({ type: 'Text', text: /A wild ZAPDOS appeared!/ })).toBeDefined()
  expect(nodes(tree, 'Button', { key: 'encounter-throw', label: 'Throw POKé BALL' }).length).toBe(1)
  expect(nodes(tree, 'Button', { key: 'encounter-run', label: 'Run' }).length).toBe(1)
  // 놓친 전설은 닫을 때까지 안내가 남는다
  expect(await pane.find({ type: 'Text', text: /Oh no! ARTICUNO fled/ })).toBeDefined()
  expect(nodes(tree, 'Button', { key: 'fled-close', label: 'Close' }).length).toBe(1)
  await pane.unmount()
})

test('다른 세션이 조금 전에 적은 진화도 이 패널이 처음 보면 그 칸의 페이지로 넘겨 보인다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1), entry('b', 6, 2), entry('c', 16, 3), entry('d', 20, 4)], lead: null, xp: 0, evolving: { key: 'd', from: 19, at: NOW - 20_000 } }
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
  // 최종 진화형이 되어 맡긴 포켓몬이 풀려도, 진화 장면을 보이는 동안은 풀밭에 그 포켓몬이 서 있다
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare', rows: 6 }).length).toBe(1)
  await pane.unmount()
})

test('몬스터볼을 누르면 기록을 쓰는 세션을 기다리지 않고 잡는 장면을 바로 보이고, 나중에 기록된 잡는 장면은 다시 보이지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let dex: Pokedex = { ...emptyPokedex(), box: [entry('b', 6, 2)], lead: 'b', chosen: true, xp: 0, encounter: { species: 146, at: NOW - 120_000, root: '/p/a', branch: null, label: 'b' } }
  const written: string[] = []
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 6: 'Charizard', 146: 'Moltres' }) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', ($, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    if (path.endsWith('mod-hud-encounter')) {
      written.push(text)
    }
    return { value: undefined }
  })
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
  expect(nodes(await pane.drawn(), 'Raster', { key: 'arrival' }).length).toBe(0)
  await pane.press({ key: 'encounter-throw' })
  // 이 세션은 기록을 쓰지 않지만 잡는 장면이 바로 뜨고 버튼은 걷힌다
  expect(written).toEqual(['throw'])
  let tree = await pane.drawn()
  expect(nodes(tree, 'Raster', { key: 'arrival' }).length).toBe(1)
  expect(nodes(tree, 'Button', { key: 'encounter-throw' }).length).toBe(0)
  // 장면이 끝나도 기록에 반영될 때까지 버튼은 다시 나오지 않는다
  await clock.advance(10_000)
  tree = await pane.drawn()
  expect(nodes(tree, 'Raster', { key: 'arrival' }).length).toBe(0)
  expect(nodes(tree, 'Button', { key: 'encounter-throw' }).length).toBe(0)
  // 기록을 쓰는 세션이 잡았다고 적어도 같은 장면을 다시 보이지 않는다
  dex = { ...dex, box: [entry('legend:146', 146, NOW + 12_000), ...dex.box], legends: [146], encounter: null, scene: { kind: 'catch', species: 146, at: NOW + 12_000 } }
  await clock.advance(30_000)
  tree = await pane.drawn()
  expect(nodes(tree, 'Raster', { key: 'arrival' }).length).toBe(0)
  expect(await pane.find({ type: 'Text', text: /^2$/ })).toBeDefined()
  await pane.unmount()
})
