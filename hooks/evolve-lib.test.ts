import { expect, test } from 'claude-code/testing'

import type { BoxEntry, Pokedex, SessionStatus } from '../types'
import { advanceEvolution, autoLead, evolutionOf, XP_GAP_MS, XP_PER_EVOLUTION_MS, xpBar, xpLeft } from './evolve-lib'
import { emptyPokedex, parsePokedex } from './nest-lib'

const ROOT = '/p/momochi'
const NOW = 100 * 60 * 60 * 1000

const session = (id: string, patch: Partial<SessionStatus> = {}): SessionStatus => ({
  id,
  cwd: ROOT,
  root: ROOT,
  project: 'momochi',
  branch: `feat/${id}`,
  state: 'working',
  updatedAt: NOW,
  prompt: '일해줘',
  todos: null,
  ...patch,
})

// 박스 칸. at 이 작을수록 먼저 잡은 포켓몬이다
const entry = (key: string, species: number, at = 0): BoxEntry => ({ key, species, root: ROOT, branch: `feat/${key}`, label: key, at })

const dexOf = (patch: Partial<Pokedex> = {}): Pokedex => ({ ...emptyPokedex(), ...patch })

test('일하는 세션만, 대시보드를 빼고 경험치를 쌓는다', () => {
  const sessions = [
    session('a'),
    session('b'),
    session('c', { state: 'waiting' }),
    session('d', { isDashboard: true }),
  ]
  const { dex } = advanceEvolution(dexOf({ xpAt: NOW - 60_000 }), sessions, NOW)
  expect(dex.xp).toBe(120_000)
  expect(dex.xpAt).toBe(NOW)
})

test('5분 넘게 끊긴 시간은 경험치로 세지 않는다', () => {
  expect(advanceEvolution(dexOf({ xp: 7, xpAt: NOW - XP_GAP_MS - 1 }), [session('a')], NOW).dex.xp).toBe(7)
  expect(advanceEvolution(dexOf({ xp: 7, xpAt: 0 }), [session('a')], NOW).dex.xp).toBe(7)
})

test('같은 종이 3마리 이상이면 그 종이 먼저 앞장서고, 아니면 가장 먼저 잡은 포켓몬이 앞장선다', () => {
  expect(autoLead([entry('p', 16, 5), entry('r1', 19, 9), entry('r2', 19, 7), entry('r3', 19, 8)])).toBe('r2')
  expect(autoLead([entry('p', 16, 5), entry('r1', 19, 9), entry('r2', 19, 7)])).toBe('p')
})

test('진화할 수 없는 포켓몬은 앞장서지 않고, 앞장설 포켓몬이 없으면 경험치를 쌓아 둔다', () => {
  const { dex } = advanceEvolution(dexOf({ box: [entry('z', 6), entry('t', 128)], xpAt: NOW - 60_000 }), [session('a')], NOW)
  expect(dex.lead).toBe(null)
  expect(dex.xp).toBe(60_000)
})

test('경험치가 차면 앞장선 포켓몬이 진화하고 잡은 시각과 라벨은 그대로다', () => {
  const before = entry('r', 19, 42)
  const result = advanceEvolution(dexOf({ box: [before], xp: XP_PER_EVOLUTION_MS }), [], NOW)
  expect(result.dex.box[0]).toEqual({ ...before, species: 20 })
  expect(result.evolved).toEqual([{ entry: { ...before, species: 20 }, from: 19 }])
  expect(result.dex.evolving).toEqual({ key: 'r', from: 19, at: NOW })
})

test('경험치가 많이 쌓여도 한 번에 한 단계만 진화하고 0 부터 다시 센다', () => {
  const { dex, evolved } = advanceEvolution(dexOf({ box: [entry('c', 4)], xp: 10 * XP_PER_EVOLUTION_MS }), [], NOW)
  expect(dex.box[0]!.species).toBe(5)
  expect(evolved.length).toBe(1)
  expect(dex.xp).toBe(0)
})

test('고른 포켓몬은 진화해도 계속 앞장서고 최종 진화형이 되면 풀린다', () => {
  const box = [entry('old', 16, 0), entry('c', 4, 9)]
  const first = advanceEvolution(dexOf({ box, xp: XP_PER_EVOLUTION_MS }), [], NOW, 'c').dex
  expect(first.box.find(one => one.key === 'c')!.species).toBe(5)
  expect(first.lead).toBe('c')
  expect(first.chosen).toBe(true)
  const second = advanceEvolution({ ...first, xp: XP_PER_EVOLUTION_MS }, [], NOW).dex
  expect(second.box.find(one => one.key === 'c')!.species).toBe(6)
  expect(second.lead).toBe(null)
  expect(second.chosen).toBe(false)
})

test('자동으로 고른 포켓몬은 진화해도 계속 앞장선다', () => {
  const box = [entry('c', 4, 0), entry('p', 16, 9), entry('p2', 16, 10), entry('p3', 16, 11)]
  const first = advanceEvolution(dexOf({ box, lead: 'c' }), [], NOW).dex
  expect(first.lead).toBe('c')
  const evolved = advanceEvolution({ ...first, xp: XP_PER_EVOLUTION_MS }, [], NOW).dex
  expect(evolved.lead).toBe('c')
})

test('앞장을 바꿔도 경험치는 남는다', () => {
  const { dex } = advanceEvolution(dexOf({ box: [entry('a', 1), entry('b', 4, 5)], lead: 'a', xp: 1000 }), [], NOW, 'b')
  expect(dex.lead).toBe('b')
  expect(dex.xp).toBe(1000)
})

test('없는 포켓몬이나 진화할 수 없는 포켓몬을 앞장세우는 요청은 무시한다', () => {
  const dex = dexOf({ box: [entry('a', 1), entry('z', 6, 5)], lead: 'a' })
  expect(advanceEvolution(dex, [], NOW, 'nope').dex.lead).toBe('a')
  expect(advanceEvolution(dex, [], NOW, 'z').dex.lead).toBe('a')
  // 앞장선 포켓몬이 박스에서 사라졌으면 자동으로 다시 고른다
  expect(advanceEvolution(dexOf({ box: [entry('b', 1)], lead: 'gone', chosen: true }), [], NOW).dex.lead).toBe('b')
})

test('이브이는 칸 key 로 셋 중 하나로 진화하고 같은 key 는 늘 같은 종이다', () => {
  const results = new Set(Array.from({ length: 60 }, (_, i) => evolutionOf(entry(`e${i}`, 133))))
  expect([...results].sort()).toEqual([134, 135, 136])
  expect(evolutionOf(entry('e1', 133))).toBe(evolutionOf(entry('e1', 133)))
  expect(evolutionOf(entry('z', 6))).toBe(null)
})

test('진화로 불꽃 최종 진화형을 처음 만들면 파이어가 한 번만 박스에 들어온다', () => {
  const first = advanceEvolution(dexOf({ box: [entry('c', 5), entry('v', 37, 5)], xp: XP_PER_EVOLUTION_MS }), [], NOW)
  expect(first.legends.map(one => one.species)).toEqual([146])
  expect(first.dex.box[0]).toEqual({ key: 'legend:146', species: 146, root: ROOT, branch: 'feat/c', label: 'c', at: NOW })
  expect(first.dex.legends).toContain(146)
  const second = advanceEvolution({ ...first.dex, lead: 'v', xp: XP_PER_EVOLUTION_MS }, [], NOW)
  expect(second.dex.box.find(one => one.key === 'v')!.species).toBe(38)
  expect(second.legends).toEqual([])
})

test('알에서 나온 최종 진화형은 새 조건에 들지 않는다', () => {
  const { dex, legends } = advanceEvolution(dexOf({ box: [entry('z', 6)] }), [], NOW)
  expect(legends).toEqual([])
  expect(dex.box.some(one => one.species === 146)).toBe(false)
})

test('도감이 100종이면 뮤츠가, 뮤를 뺀 150종이면 뮤가 들어온다', () => {
  const ninetyNine = Array.from({ length: 99 }, (_, i) => i + 1)
  expect(advanceEvolution(dexOf({ box: [entry('a', 1)], seen: ninetyNine }), [], NOW).legends).toEqual([])
  const hundred = advanceEvolution(dexOf({ box: [entry('a', 100)], seen: ninetyNine }), [], NOW)
  expect(hundred.legends.map(one => one.species)).toEqual([150])
  const all = Array.from({ length: 149 }, (_, i) => i + 1)
  const mew = advanceEvolution(dexOf({ box: [entry('a', 150)], seen: all, legends: [150] }), [], NOW)
  expect(mew.legends.map(one => one.species)).toEqual([151])
})

test('예전 기록을 읽으면 도감은 박스로 채우고 박스에 있는 전설은 받은 것으로 친다', () => {
  const old = parsePokedex(JSON.stringify({ day: '2026-10-14', box: [entry('m', 150), entry('a', 1, 3)] }))
  expect(old.xp).toBe(0)
  expect(old.xpAt).toBe(0)
  expect(old.lead).toBe(null)
  expect(old.chosen).toBe(false)
  expect(old.seen).toEqual([])
  expect(old.legends).toEqual([])
  expect(old.evolving).toBe(null)
  const { dex, legends } = advanceEvolution(old, [], NOW)
  expect([...dex.seen].sort((a, b) => a - b)).toEqual([1, 150])
  expect(dex.legends).toContain(150)
  expect(legends).toEqual([])
  expect(dex.box.filter(one => one.species === 150).length).toBe(1)
})

test('경험치 막대는 다섯 칸이고 남은 시간을 짧게 쓴다', () => {
  expect(xpBar(0)).toBe('░░░░░')
  expect(xpBar(XP_PER_EVOLUTION_MS * 0.4)).toBe('▓▓░░░')
  expect(xpBar(XP_PER_EVOLUTION_MS)).toBe('▓▓▓▓▓')
  expect(xpLeft(XP_PER_EVOLUTION_MS - 70 * 60_000)).toBe('1h10m')
  expect(xpLeft(XP_PER_EVOLUTION_MS - 25 * 60_000 - 30_000)).toBe('26m')
  expect(xpLeft(XP_PER_EVOLUTION_MS + 5)).toBe('0m')
})
