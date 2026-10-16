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

// PokeAPI 의 40x30 피카츄 아이콘. 투명한 테두리를 잘라 내면 폭이 PIKACHU_COLUMNS 다
const ICON = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeBAMAAACs80HuAAAAIVBMVEUxMTExMTFSUlKchEKlazG1cym9lCHFpSn3Y1L31jH///98M3JMAAAAAXRSTlMAQObYZgAAAJVJREFUKJHVjzEKw0AQA7U/uEuR5UqbgLnSpUt/IT9xmiVPcHmGYKvMT1PvxpA6KocRQsCfJZ8w6QBA0gksi4O6ADnv5lQdkftqDoomYW/m6spWOASR5LQFUcgnR/UzhfubTbxZJl7IpLF+rGy+fh14rLzP/mQ2VvLmr0MfrK8OAVpPBhFi5BYhcmGLDJDyJQKQE/YrHwXQKRtr0GeSAAAAAElFTkSuQmCC'
const PIKACHU_COLUMNS = 21

const entry = (key: string, species: number, at: number): BoxEntry => ({ key, species, root: '/p/a', branch: null, label: key, at })

test('옆에 붙은 패널은 DAY CARE 머리줄에 맡긴 포켓몬과 경험치를 보이고 PC BOX 를 한 줄에 한 마리씩 글자로 보인다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1), entry('b', 6, 2), entry('c', 16, 3)], lead: 'a', xp: 0 }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => {
    const path = (e as unknown as { path: string }).path
    return { value: path.endsWith('mod-hud-pokedex.json') || path.endsWith('icons/16.png') }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    // 구구 자리에 피카츄 아이콘을 둔다
    if (path.endsWith('icons/16.png')) {
      return { value: { base64: ICON } } as never
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

  const props = { placement: 'dock', bodyColumns: 66, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  expect(await pane.find({ type: 'Text', text: /PC BOX/ })).toBeDefined()
  // 키우미집에 맡겨 키우는 포켓몬과 경험치는 DAY CARE 머리줄에 보이고 PC BOX 머리줄에는 없다
  const header = (key: string) => nodes(tree0(), 'Button', { key }).map(textOf).join('')
  let drawnNow = await pane.drawn()
  const tree0 = () => drawnNow
  expect(header('daycare-toggle')).toContain('★ Rattata ░░░░░ 3h0m')
  expect(header('box-toggle')).not.toContain('Rattata')
  // 박스는 도트 없이 한 줄에 한 마리씩 이름과 속성, 잡은 날짜를 글자로 보인다. 맡긴 포켓몬은 ★ 를 단다
  let tree = await pane.drawn()
  expect(nodes(tree, 'Raster').some(raster => String(raster.props?.key).startsWith('tile-'))).toBe(false)
  const row = (key: string) => nodes(tree, 'Button', { key: `box-row-${key}` }).map(textOf).join('')
  expect(row('a')).toBe('★ RATTATA  NORMAL')
  expect(row('b')).toBe('  CHARIZARD  FIRE/FLYING')
  expect(row('c')).toBe('  PIDGEY  NORMAL/FLYING')
  // 다음 진화는 미리 보이지 않고, 키우미집 버튼은 줄을 펼치기 전에는 없다
  expect(await pane.find({ type: 'Text', text: /Raticate|Pidgeotto/ })).toBeUndefined()
  expect(nodes(tree, 'Button', { key: 'lead-c' }).length).toBe(0)
  // 펼치기 전에는 박스 포켓몬의 도트를 그리지 않는다
  expect(nodes(tree, 'Raster').some(raster => String(raster.props?.key).startsWith('box-portrait-'))).toBe(false)
  // 줄을 누르면 그 포켓몬의 도트와 잡은 날짜, 어디서 왔는지, 진화할 수 있으면 Leave at DAY CARE 버튼이 펼쳐진다
  await pane.press({ key: 'box-row-c' })
  tree = await pane.drawn()
  // 도트는 받은 뒤 다시 그릴 때 나타난다
  tree = await pane.drawn()
  expect(nodes(tree, 'Raster', { key: 'box-portrait-c', columns: PIKACHU_COLUMNS }).length).toBe(1)
  expect(await pane.find({ type: 'Text', text: /caught 1970-01-01 · c/ })).toBeDefined()
  expect(nodes(tree, 'Button', { key: 'lead-c', label: 'Leave at DAY CARE' }).length).toBe(1)
  // 다른 줄을 누르면 그 줄만 펼쳐진다. 진화하지 않는 최종 진화형도 맡길 수 있다
  await pane.press({ key: 'box-row-b' })
  tree = await pane.drawn()
  expect(nodes(tree, 'Button', { key: 'lead-c' }).length).toBe(0)
  expect(nodes(tree, 'Button', { key: 'lead-b', label: 'Leave at DAY CARE' }).length).toBe(1)
  // 같은 줄을 다시 누르면 접힌다
  await pane.press({ key: 'box-row-b' })
  expect(await pane.find({ type: 'Text', text: /caught/ })).toBeUndefined()
  // DAY CARE 머리줄을 누르면 풀밭을 접고 남은 알 수만 남긴다. 다시 누르면 편다
  // 앞장선 포켓몬이 걸을 수 있게 풀밭이 높아진다
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare', rows: 11 }).length).toBe(1)
  await pane.press({ key: 'daycare-toggle' })
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare' }).length).toBe(0)
  // 접어도 머리줄의 남은 알 수와 맡긴 포켓몬의 경험치는 남는다
  drawnNow = await pane.drawn()
  expect(header('daycare-toggle')).toContain('★ Rattata ░░░░░ 3h0m')
  await pane.press({ key: 'daycare-toggle' })
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare' }).length).toBe(1)
  // PC BOX 머리줄을 누르면 박스를 접는다. 다시 누르면 편다
  await pane.press({ key: 'box-toggle' })
  expect(nodes(await pane.drawn(), 'Button', { key: 'box-row-a' }).length).toBe(0)
  await pane.press({ key: 'box-toggle' })
  expect(nodes(await pane.drawn(), 'Button', { key: 'box-row-a' }).length).toBe(1)
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

  const props = { placement: 'dock', bodyColumns: 66, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  expect(nodes(await pane.drawn(), 'Button', { key: 'daycare-toggle' }).map(textOf).join('')).toContain('★ Charizard MAX')
  // 맡긴 포켓몬의 줄을 펼치면 Take back, 진화할 수 있는 포켓몬의 줄을 펼치면 Leave at DAY CARE 가 있다
  await pane.press({ key: 'box-row-b' })
  expect(nodes(await pane.drawn(), 'Button', { key: 'takeback-b', label: 'Take back' }).length).toBe(1)
  await pane.press({ key: 'box-row-a' })
  const tree = await pane.drawn()
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
  const box = [entry('a', 19, 1), entry('b', 6, 2), entry('c', 16, 3), entry('e', 16, 4), entry('f', 16, 5), entry('g', 16, 6), entry('d', 20, 7)]
  const dex: Pokedex = { ...emptyPokedex(), box, lead: null, xp: 0, evolving: { key: 'd', from: 19, at: NOW - 20_000 } }
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
  // 기록을 쓰는 세션이 20초 전에 적은 진화라도 이 패널은 처음 보므로 그 줄이 있는 페이지로 넘긴다
  expect(await pane.find({ type: 'Text', text: /PC BOX  2\/2/ })).toBeDefined()
  expect(nodes(await pane.drawn(), 'Button', { key: 'box-row-d' }).length).toBe(1)
  // 최종 진화형이 되어 맡긴 포켓몬이 풀려도, 진화 장면을 보이는 동안은 풀밭에 그 포켓몬이 서 있다
  expect(nodes(await pane.drawn(), 'Raster', { key: 'daycare', rows: 11 }).length).toBe(1)
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

test('박스로 보내기를 누르면 기록을 쓰는 세션을 기다리지 않고 버튼을 걷고, 기록에 반영될 때까지 다시 보이지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const hatchedEgg = { key: 'egg1', species: 13, root: '/p/a', branch: 'feat/x', label: 'feat/x', at: NOW - 1000 }
  let dex: Pokedex = { ...emptyPokedex(), pending: [{ ...hatchedEgg, mrState: 'merged' }], hatched: { egg1: NOW - 1000 } }
  const written: string[] = []
  const toasts: string[] = []
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 13: 'Weedle' }) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', ($, e) => {
    const { path } = e as unknown as { path: string }
    if (path.includes('mod-hud-sendbox')) {
      written.push(path)
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
  on('ui.toast', ($, e) => {
    toasts.push((e as unknown as { text: string }).text)
    return { value: undefined }
  })
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/p/a' } as never)

  const props = { placement: 'dock', bodyColumns: 60, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  expect(nodes(await pane.drawn(), 'Button', { key: 'send-egg1' }).length).toBe(1)
  await pane.press({ key: 'send-egg1' })
  // 이 세션은 기록을 쓰지 않지만 요청을 남기고 토스트를 띄우며 버튼은 바로 걷힌다
  expect(written).toEqual(['/home/test/.claude/mod-hud-sendbox/egg1'])
  expect(toasts).toEqual(['Weedle was sent to the PC BOX (feat/x)'])
  expect(nodes(await pane.drawn(), 'Button', { key: 'send-egg1' }).length).toBe(0)
  // 기록을 쓰는 세션이 아직 반영하지 않아도 다음 조회에서 버튼이 되살아나지 않는다
  await clock.advance(30_000)
  expect(nodes(await pane.drawn(), 'Button', { key: 'send-egg1' }).length).toBe(0)
  // 기록을 쓰는 세션이 박스에 넣으면 박스에 보인다
  dex = { ...dex, pending: [], hatched: {}, box: [entry('egg1', 13, NOW + 31_000)] }
  await clock.advance(30_000)
  expect(nodes(await pane.drawn(), 'Button', { key: 'send-egg1' }).length).toBe(0)
  expect(await pane.find({ type: 'Text', text: /^1$/ })).toBeDefined()
  await pane.unmount()
})

test('Refresh now 를 누르면 1분 동안 버튼 대신 조회 중인지, 끝났는지를 보이고 다시 누를 수 없다', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
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
  expect(nodes(await pane.drawn(), 'Button', { key: 'refresh' }).length).toBe(1)
  await pane.press({ key: 'refresh' })
  expect(nodes(await pane.drawn(), 'Button', { key: 'refresh' }).length).toBe(0)
  expect(await pane.find({ type: 'Text', text: /Refreshed · again in 1m/ })).toBeDefined()
  // 1분이 지나기 전에는 버튼이 돌아오지 않는다
  await clock.advance(59_000)
  expect(nodes(await pane.drawn(), 'Button', { key: 'refresh' }).length).toBe(0)
  await clock.advance(1_000)
  expect(nodes(await pane.drawn(), 'Button', { key: 'refresh' }).length).toBe(1)
  await pane.unmount()
})
