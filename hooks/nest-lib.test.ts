import { expect, test } from 'claude-code/testing'

import type { DexEgg, SessionStatus } from '../types'
import {
  advancePokedex,
  boxPageOf,
  boxPages,
  CELEBRATE_MS,
  DEX_SIZE,
  drawNest,
  eggsOf,
  emptyPokedex,
  keeperOf,
  nestRows,
  parsePokedex,
  speciesOf,
  speciesToLoad,
  updatePending,
} from './nest-lib'
import type { SpriteLookup } from './nest-lib'

const ROOT = '/p/momochi'
const NOW = 10 * 60 * 60 * 1000

const session = (id: string, patch: Partial<SessionStatus> = {}): SessionStatus => ({
  id,
  cwd: ROOT,
  root: ROOT,
  project: 'momochi',
  branch: `feat/${id}`,
  state: 'waiting',
  updatedAt: NOW,
  prompt: '일해줘',
  todos: null,
  ...patch,
})

const dexEgg = (key: string, patch: Partial<DexEgg> = {}): DexEgg => ({
  key,
  species: 25,
  root: ROOT,
  branch: `feat/#ENA-${key}`,
  label: `#ENA-${key}`,
  at: 0,
  ...patch,
})

const closed = { state: 'ended' as const }

test('브랜치에 이슈 번호가 있으면 알 이름은 이슈 번호다', () => {
  expect(eggsOf([session('a', { branch: 'feat/#ENA-12-login' })], emptyPokedex(), NOW)[0]!.label).toBe('#ENA-12')
})

test('열린 세션마다 알이 하나 있고, 그 브랜치의 MR 에 따라 금이 가거나 부화한다', () => {
  const sessions = [
    session('a'),
    session('b', { mrState: 'opened' }),
    session('c', { mrState: 'merged' }),
    session('d', { ...closed }),
    session('e', { branch: 'main' }),
  ]
  const eggs = eggsOf(sessions, emptyPokedex(), NOW)
  expect(eggs.map(egg => [egg.label, egg.stage])).toEqual([
    ['feat/a', 'egg'],
    ['feat/b', 'cracked'],
    ['feat/c', 'hatched'],
    ['momochi', 'egg'],
  ])
})

test('대시보드로 표시한 세션만 알이 없고, 닫혀도 키우미집에 가지 않는다', () => {
  const sessions = [session('a', { prompt: null }), session('b', { isDashboard: true }), session('c')]
  expect(eggsOf(sessions, emptyPokedex(), NOW).map(egg => egg.key)).toEqual(['a', 'c'])
  const gone = advancePokedex(emptyPokedex(), sessions.map(one => ({ ...one, ...closed })), NOW)
  expect(gone.dex.daycare.map(egg => egg.key).sort()).toEqual(['a', 'c'])
})

test('iTerm2 리뷰 세션은 알이 없고, 닫혀도 키우미집에 가지 않는다', () => {
  const sessions = [session('a'), session('r', { prompt: 'Review the pending changes in this repo. Flag…' })]
  expect(eggsOf(sessions, emptyPokedex(), NOW).map(egg => egg.key)).toEqual(['a'])
  const gone = advancePokedex(emptyPokedex(), sessions.map(one => ({ ...one, ...closed })), NOW)
  expect(gone.dex.daycare.map(egg => egg.key)).toEqual(['a'])
})

test('나를 기다리는 세션은 mine, 일하는 세션은 working 으로 라벨 색을 정한다', () => {
  const sessions = [
    session('a', { state: 'working' }),
    session('b', { attention: { kind: 'question', since: NOW, text: '?' } }),
    session('c'),
  ]
  expect(eggsOf(sessions, emptyPokedex(), NOW).map(egg => egg.activity)).toEqual(['working', 'mine', null])
})

test('일하는 세션의 알만 흔들리고, 부화한 뒤에는 흔들리지 않는다', () => {
  const sessions = [session('a', { state: 'working' }), session('b'), session('c', { state: 'working', mrState: 'merged' })]
  expect(eggsOf(sessions, emptyPokedex(), NOW).map(egg => egg.isShaking)).toEqual([true, false, false])
})

test('같은 세션은 늘 같은 포켓몬이고, 세션이 다르면 1세대 151마리에 고르게 퍼진다', () => {
  expect(speciesOf('abc')).toBe(speciesOf('abc'))
  const seen = new Set(Array.from({ length: 3000 }, (_, i) => speciesOf(`session-${i}`)))
  expect(seen.size).toBe(DEX_SIZE)
  expect(Math.min(...seen)).toBe(1)
  expect(Math.max(...seen)).toBe(DEX_SIZE)
})

test('열린 세션 중 id 가 가장 작은 세션 하나만 기록을 쓴다', () => {
  expect(keeperOf([session('b'), session('a', { ...closed }), session('c')], NOW)).toBe('b')
  expect(keeperOf([session('a', { ...closed })], NOW)).toBe(null)
})

test('열린 세션의 MR 이 처음 머지되면 한 번만 부화한다', () => {
  const sessions = [session('a', { mrState: 'merged' }), session('b')]
  const first = advancePokedex(emptyPokedex(), sessions, NOW)
  expect(first.born.map(egg => egg.key)).toEqual(['a'])
  expect(first.dex.hatched.a).toBe(NOW)
  expect(advancePokedex(first.dex, sessions, NOW + 1).born).toEqual([])
})

test('MR 없이 닫힌 세션의 알은 키우미집으로 가고, 한 번만 맡긴다', () => {
  const sessions = [session('a', { ...closed })]
  const first = advancePokedex(emptyPokedex(), sessions, NOW)
  expect(first.left.map(egg => egg.label)).toEqual(['feat/a'])
  expect(first.dex.daycare.map(egg => egg.key)).toEqual(['a'])
  const again = advancePokedex(first.dex, sessions, NOW + 1)
  expect(again.left).toEqual([])
  expect(again.dex.daycare.length).toBe(1)
})

test('같은 저장소와 브랜치로 세션을 다시 열면 키우미집의 알을 데려온다', () => {
  const dex = { ...emptyPokedex(), daycare: [dexEgg('old', { branch: 'feat/x', species: 133 })] }
  const after = advancePokedex(dex, [session('new', { branch: 'feat/x' })], NOW)
  expect(after.claimed.map(egg => egg.key)).toEqual(['old'])
  expect(after.dex.daycare).toEqual([])
  expect(eggsOf([session('new', { branch: 'feat/x' })], after.dex, NOW)[0]!.species).toBe(133)
})

test('닫힌 것으로 본 세션이 잠자기에서 돌아오면 키우미집에 간 자기 알을 되찾는다', () => {
  const gone = advancePokedex(emptyPokedex(), [session('a', { updatedAt: NOW - 2 * 60 * 60 * 1000 })], NOW).dex
  expect(gone.daycare.map(egg => egg.key)).toEqual(['a'])
  const back = advancePokedex(gone, [session('a')], NOW + 1).dex
  expect(back.daycare).toEqual([])
  expect(back.done).toEqual([])
})

test('/clear 로 이어진 세션은 끝난 세션의 알을 물려받고, 키우미집에 보내지 않는다', () => {
  const live = advancePokedex(emptyPokedex(), [session('old', { branch: 'main', mrState: 'merged' })], NOW).dex
  const sessions = [
    session('old', { branch: 'main', state: 'ended', endReason: 'clear', mrState: 'merged' }),
    session('new', { branch: 'main', predecessor: 'old' }),
  ]
  const after = advancePokedex(live, sessions, NOW + 1)
  expect(after.left).toEqual([])
  expect(after.dex.daycare).toEqual([])
  expect(after.dex.hatched.new).toBe(NOW)
  expect(eggsOf(sessions, after.dex, NOW + 1).map(egg => [egg.key, egg.species])).toEqual([['new', speciesOf('old')]])
})

test('/clear 로 끝난 세션은 이어 받을 세션을 잠깐 기다리고, 끝내 안 오면 키우미집에 간다', () => {
  const ended = session('old', { state: 'ended', endReason: 'clear', updatedAt: NOW })
  expect(advancePokedex(emptyPokedex(), [ended], NOW + 1).left).toEqual([])
  expect(advancePokedex(emptyPokedex(), [ended], NOW + 3 * 60 * 1000).left.map(egg => egg.key)).toEqual(['old'])
})

test('main 처럼 오래 가는 브랜치의 세션은 키우미집 알을 데려가지 않는다', () => {
  const dex = { ...emptyPokedex(), daycare: [dexEgg('old', { branch: 'main' })] }
  expect(advancePokedex(dex, [session('new', { branch: 'main' })], NOW).claimed).toEqual([])
})

test('MR 이 열린 채 닫힌 세션의 알은 금 간 채 남아 머지를 기다린다', () => {
  const first = advancePokedex(emptyPokedex(), [session('a', { ...closed, mrState: 'opened' })], NOW)
  expect(first.dex.pending.map(egg => egg.key)).toEqual(['a'])
  expect(eggsOf([], first.dex, NOW).map(egg => egg.stage)).toEqual(['cracked'])
})

test('기다리던 MR 이 머지되면 부화해 잠깐 뛰다가 박스로 간다', () => {
  const sessions = [session('a', { ...closed, mrState: 'opened' })]
  const waiting = advancePokedex(emptyPokedex(), sessions, NOW).dex
  const merged = advancePokedex(updatePending(waiting, 'a', 'merged'), sessions, NOW + 1)
  expect(merged.born.map(egg => egg.key)).toEqual(['a'])
  expect(merged.boxed).toEqual([])
  expect(eggsOf([], merged.dex, NOW + 1).map(egg => egg.stage)).toEqual(['hatched'])
  const later = advancePokedex(merged.dex, sessions, NOW + 1 + CELEBRATE_MS)
  expect(later.boxed.map(egg => egg.key)).toEqual(['a'])
  expect(later.dex.box.map(egg => egg.key)).toEqual(['a'])
  expect(later.dex.pending).toEqual([])
})

test('부화한 세션이 닫히면 바로 박스로 간다', () => {
  const live = advancePokedex(emptyPokedex(), [session('a', { mrState: 'merged' })], NOW).dex
  const after = advancePokedex(live, [session('a', { ...closed, mrState: 'merged' })], NOW + CELEBRATE_MS)
  expect(after.boxed.map(egg => egg.key)).toEqual(['a'])
})

test('부화한 알을 박스로 보내면 그 세션에는 새 알이 생기고, 같은 브랜치에 있는 동안은 다시 부화하지 않는다', () => {
  const sessions = [session('a', { mrState: 'merged' }), session('b')]
  const hatchedDex = advancePokedex(emptyPokedex(), sessions, NOW).dex
  const sent = advancePokedex(hatchedDex, sessions, NOW + 1, ['a', 'b'])
  expect(sent.boxed.map(egg => egg.key)).toEqual(['a'])
  expect(sent.dex.box.map(egg => egg.key)).toEqual(['a'])
  const eggs = eggsOf(sessions, sent.dex, NOW + 1)
  expect(eggs.map(egg => [egg.key, egg.stage])).toEqual([
    ['a#1', 'egg'],
    ['b', 'egg'],
  ])
  expect(eggs[0]!.species).toBe(speciesOf('a#1'))
  // 같은 브랜치에서는 다시 부화하지 않고, 닫히면 키우미집으로 간다
  expect(advancePokedex(sent.dex, sessions, NOW + 2).born).toEqual([])
  const after = advancePokedex(sent.dex, [session('a', { ...closed, mrState: 'merged' }), session('b')], NOW + 3)
  expect(after.boxed).toEqual([])
  expect(after.dex.daycare.map(egg => egg.key)).toEqual(['a#1'])
})

test('박스로 보낸 세션이 다른 브랜치로 옮겨 MR 이 열리면 새 알에 금이 간다', () => {
  const merged = advancePokedex(emptyPokedex(), [session('a', { mrState: 'merged' })], NOW).dex
  const sent = advancePokedex(merged, [session('a', { mrState: 'merged' })], NOW + 1, ['a']).dex
  const moved = [session('a', { branch: 'feat/next', mrState: 'opened' })]
  expect(eggsOf(moved, sent, NOW + 2).map(egg => [egg.key, egg.stage])).toEqual([['a#1', 'cracked']])
})

test('닫힌 뒤 부화해 뛰고 있는 알도 박스로 보내기를 누르면 바로 간다', () => {
  const sessions = [session('a', { ...closed, mrState: 'merged' })]
  const waiting = advancePokedex(emptyPokedex(), sessions, NOW).dex
  expect(waiting.pending.length).toBe(1)
  const sent = advancePokedex(waiting, sessions, NOW + 1, ['a'])
  expect(sent.boxed.map(egg => egg.key)).toEqual(['a'])
  expect(sent.dex.pending).toEqual([])
})

test('기다리던 MR 이 머지 없이 닫히면 키우미집으로 간다', () => {
  const sessions = [session('a', { ...closed, mrState: 'opened' })]
  const waiting = advancePokedex(emptyPokedex(), sessions, NOW).dex
  const after = advancePokedex(updatePending(waiting, 'a', 'closed'), sessions, NOW + 1)
  expect(after.left.map(egg => egg.key)).toEqual(['a'])
  expect(after.dex.daycare.map(egg => egg.key)).toEqual(['a'])
})

test('깨진 기록 파일은 빈 기록으로 읽는다', () => {
  expect(parsePokedex('{oops')).toEqual(emptyPokedex())
  expect(parsePokedex('{"box": 3}')).toEqual(emptyPokedex())
})

test('금 간 알과 부화한 알, 박스 이번 페이지의 포켓몬만 스프라이트를 불러온다', () => {
  const eggs = eggsOf([session('a'), session('b', { mrState: 'opened' }), session('c', { mrState: 'merged' })], emptyPokedex(), NOW)
  const box = [dexEgg('k', { species: 150 })]
  expect(speciesToLoad({ eggs, daycare: [], box, boxPage: 0 }, 80)).toEqual([eggs[1]!.species, eggs[2]!.species, 150])
})

test('그림은 알 줄, 키우미집, 박스를 합친 줄 수만큼 칸을 채우고 프레임마다 움직인다', () => {
  const eggs = eggsOf([session('a', { state: 'working' }), session('b', { mrState: 'merged' })], emptyPokedex(), NOW)
  const input = { eggs, daycare: [dexEgg('d')], box: [dexEgg('k')], boxPage: 0 }
  const width = 40
  const none: SpriteLookup = () => undefined
  const cells = drawNest(input, width, 1, NOW, none)
  expect(cells.length).toBe(width * nestRows(input, width) * 3)
  expect(drawNest(input, width, 1, NOW, none)).toEqual(cells)
  expect(drawNest(input, width, 2, NOW, none)).not.toEqual(cells)
  // 박스만 있으면 프레임이 바뀌어도 그대로다
  const boxOnly = { eggs: [], daycare: [], box: [dexEgg('k')], boxPage: 0 }
  expect(drawNest(boxOnly, width, 1, NOW, none)).toEqual(drawNest(boxOnly, width, 2, NOW, none))
  expect(nestRows({ ...input, daycare: [] }, width)).toBe(nestRows(input, width) - 6)
})

test('스프라이트를 불러오면 몬스터볼 대신 그 그림을 그린다', () => {
  const input = { eggs: [], daycare: [], box: [dexEgg('k')], boxPage: 0 }
  const dot: SpriteLookup = () => ({ width: 1, height: 1, px: [0x123456] })
  const withDot = drawNest(input, 40, 0, NOW, dot)
  expect(withDot).not.toEqual(drawNest(input, 40, 0, NOW, () => undefined))
  expect(Array.from(withDot).includes(0x123456)).toBe(true)
})

test('알과 키우미집이 비면 박스만 그린다', () => {
  expect(nestRows({ eggs: [], daycare: [], box: [], boxPage: 0 }, 40)).toBe(1 + 12)
})

test('박스가 한 페이지를 넘으면 페이지를 나누고, 페이지를 넘겨도 그림 높이는 그대로다', () => {
  // 폭 72 는 한 줄에 세 마리, 한 페이지에 여섯 마리
  const box = Array.from({ length: 7 }, (_, i) => ({ ...dexEgg(`k${i}`), species: i + 1 }))
  const first = { eggs: [], daycare: [], box, boxPage: 0 }
  const second = { ...first, boxPage: 1 }
  expect(boxPages(first, 72)).toBe(2)
  expect(nestRows(first, 72)).toBe(nestRows(second, 72))
  expect(speciesToLoad(first, 72)).toEqual([1, 2, 3, 4, 5, 6])
  expect(speciesToLoad(second, 72)).toEqual([7])
  // 박스가 줄어 페이지가 사라지면 마지막 페이지로 당긴다
  expect(boxPageOf({ ...first, boxPage: 5 }, 72)).toBe(1)
})
