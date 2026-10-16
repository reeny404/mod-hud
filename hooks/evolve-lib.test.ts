import { expect, test } from 'claude-code/testing'

import type { BoxEntry, Pokedex, SessionStatus } from '../types'
import { advanceEvolution, autoLead, ENCOUNTER_MS, SCENE_GAP_MS, evolutionOf, TAKE_BACK, XP_GAP_MS, XP_PER_EVOLUTION_MS, xpBar, xpLeft } from './evolve-lib'
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

test('맡긴 포켓몬은 최종 진화형이 되어도 데려올 때까지 키우미집에 남는다', () => {
  const box = [entry('old', 16, 0), entry('c', 4, 9)]
  const first = advanceEvolution(dexOf({ box, xp: XP_PER_EVOLUTION_MS }), [], NOW, 'c').dex
  expect(first.box.find(one => one.key === 'c')!.species).toBe(5)
  expect(first.lead).toBe('c')
  expect(first.chosen).toBe(true)
  const second = advanceEvolution({ ...first, xp: XP_PER_EVOLUTION_MS }, [], NOW).dex
  expect(second.box.find(one => one.key === 'c')!.species).toBe(6)
  expect(second.lead).toBe('c')
  expect(second.chosen).toBe(true)
})

test('최종 진화형이 맡겨져 있으면 경험치가 쌓이지 않는다', () => {
  const { dex } = advanceEvolution(dexOf({ box: [entry('z', 6), entry('p', 16, 5)], lead: 'z', chosen: true, xpAt: NOW - 60_000 }), [session('a')], NOW)
  expect(dex.lead).toBe('z')
  expect(dex.xp).toBe(0)
})

test('진화하지 않는 메타몽도 Leave at DAY CARE 로 맡길 수 있고, 맡긴 동안은 경험치가 쌓이지 않는다', () => {
  const box = [entry('ditto', 132, 9), entry('p', 16, 5)]
  const { dex } = advanceEvolution(dexOf({ box, lead: 'p', xp: 1000, xpAt: NOW - 60_000 }), [session('a')], NOW, 'ditto')
  expect(dex.lead).toBe('ditto')
  expect(dex.chosen).toBe(true)
  expect(dex.xp).toBe(1000)
  // 없는 key 를 고르면 그대로 둔다
  expect(advanceEvolution(dexOf({ box, lead: 'p', chosen: true }), [], NOW, 'nope').dex.lead).toBe('p')
})

test('Take back 을 누르면 키우미집에서 데려오고 다른 포켓몬이 자동으로 맡겨진다', () => {
  const box = [entry('z', 6, 0), entry('p', 16, 5)]
  const { dex } = advanceEvolution(dexOf({ box, lead: 'z', chosen: true }), [], NOW, TAKE_BACK)
  expect(dex.lead).toBe('p')
  expect(dex.chosen).toBe(false)
  // 맡길 포켓몬이 없으면 비어 있다
  const alone = advanceEvolution(dexOf({ box: [entry('z', 6)], lead: 'z', chosen: true }), [], NOW, TAKE_BACK).dex
  expect(alone.lead).toBe(null)
})

test('전설 조건을 채우면 박스에 바로 넣지 않고 야생으로 나타나 모든 패널이 등장 장면을 보인다', () => {
  const { dex, legends } = advanceEvolution(dexOf({ box: [entry('c', 5)], xp: XP_PER_EVOLUTION_MS }), [], NOW)
  expect(legends).toEqual([])
  expect(dex.box.some(one => one.species === 146)).toBe(false)
  expect(dex.encounter).toEqual({ species: 146, at: NOW, root: ROOT, branch: 'feat/c', label: 'c' })
  expect(dex.scene).toEqual({ kind: 'appear', species: 146, at: NOW })
  expect(dex.legends).not.toContain(146)
  // 아무 일 없으면 그대로 기다린다
  expect(advanceEvolution(dex, [], NOW + 1000).dex.encounter?.species).toBe(146)
})

test('몬스터볼을 던지면 잡혀 박스에 들어오고 잡는 장면을 보인다', () => {
  const met = advanceEvolution(dexOf({ box: [entry('c', 5)], xp: XP_PER_EVOLUTION_MS }), [], NOW).dex
  const { dex, legends } = advanceEvolution(met, [], NOW + 5000, null, 'throw')
  expect(legends.map(one => one.species)).toEqual([146])
  expect(dex.box[0]).toEqual({ key: 'legend:146', species: 146, root: ROOT, branch: 'feat/c', label: 'c', at: NOW + 5000 })
  expect(dex.legends).toContain(146)
  expect(dex.encounter).toBe(null)
  expect(dex.scene).toEqual({ kind: 'catch', species: 146, at: NOW + 5000 })
})

test('Run 을 누르거나 한 시간 동안 두면 놓치고, 놓친 안내는 닫을 때까지 남는다', () => {
  const met = advanceEvolution(dexOf({ box: [entry('c', 5)], xp: XP_PER_EVOLUTION_MS }), [], NOW).dex
  const ran = advanceEvolution(met, [], NOW + 5000, null, 'run')
  expect(ran.dex.encounter).toBe(null)
  expect(ran.dex.fled).toEqual({ species: 146 })
  expect(ran.fled).toEqual([146])
  expect(ran.dex.box.some(one => one.species === 146)).toBe(false)
  expect(advanceEvolution(ran.dex, [], NOW + 99_999_999).dex.fled).toEqual({ species: 146 })
  expect(advanceEvolution(ran.dex, [], NOW + 6000, null, 'dismiss').dex.fled).toBe(null)
  const ignored = advanceEvolution(met, [], NOW + ENCOUNTER_MS).dex
  expect(ignored.encounter).toBe(null)
  expect(ignored.fled).toEqual({ species: 146 })
})

test('놓친 전설은 다음에 그 조건의 최종 진화형을 만들 때 다시 나타나고, 잡은 전설은 다시 나타나지 않는다', () => {
  const met = advanceEvolution(dexOf({ box: [entry('c', 5), entry('v', 37, 5)], xp: XP_PER_EVOLUTION_MS }), [], NOW).dex
  const later = (n: number) => NOW + n * SCENE_GAP_MS
  const ran = advanceEvolution(met, [], later(1), null, 'run').dex
  const again = advanceEvolution({ ...ran, lead: 'v', xp: XP_PER_EVOLUTION_MS }, [], later(2)).dex
  expect(again.encounter?.species).toBe(146)
  const caught = advanceEvolution(again, [], later(3), null, 'throw').dex
  const third = advanceEvolution({ ...caught, box: [...caught.box, entry('w', 58, 9)], lead: 'w', xp: XP_PER_EVOLUTION_MS }, [], later(4)).dex
  expect(third.encounter).toBe(null)
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

test('박스에 없는 포켓몬을 맡기는 요청은 무시하고, 최종 진화형은 맡길 수 있다', () => {
  const dex = dexOf({ box: [entry('a', 1), entry('z', 6, 5)], lead: 'a' })
  expect(advanceEvolution(dex, [], NOW, 'nope').dex.lead).toBe('a')
  expect(advanceEvolution(dex, [], NOW, 'z').dex.lead).toBe('z')
  // 앞장선 포켓몬이 박스에서 사라졌으면 자동으로 다시 고른다
  expect(advanceEvolution(dexOf({ box: [entry('b', 1)], lead: 'gone', chosen: true }), [], NOW).dex.lead).toBe('b')
})

test('이브이는 칸 key 로 셋 중 하나로 진화하고 같은 key 는 늘 같은 종이다', () => {
  const results = new Set(Array.from({ length: 60 }, (_, i) => evolutionOf(entry(`e${i}`, 133))))
  expect([...results].sort()).toEqual([134, 135, 136])
  expect(evolutionOf(entry('e1', 133))).toBe(evolutionOf(entry('e1', 133)))
  expect(evolutionOf(entry('z', 6))).toBe(null)
})


test('알에서 나온 최종 진화형은 새 조건에 들지 않는다', () => {
  const { dex } = advanceEvolution(dexOf({ box: [entry('z', 6)] }), [], NOW)
  expect(dex.encounter).toBe(null)
})
test('도감이 100종이면 뮤츠가, 뮤를 뺀 150종이면 뮤가 나타나고, 놓치면 다음에 새 포켓몬이 박스에 들어올 때 다시 나타난다', () => {
  const ninetyNine = Array.from({ length: 99 }, (_, i) => i + 1)
  expect(advanceEvolution(dexOf({ box: [entry('a', 1)], seen: ninetyNine }), [], NOW).dex.encounter).toBe(null)
  const hundred = advanceEvolution(dexOf({ box: [entry('a', 100)], seen: ninetyNine }), [], NOW).dex
  expect(hundred.encounter?.species).toBe(150)
  const later = (n: number) => NOW + n * SCENE_GAP_MS
  const ran = advanceEvolution(hundred, [], later(1), null, 'run').dex
  // 조건은 계속 채워져 있지만 새 포켓몬이 없으면 다시 나타나지 않는다
  expect(advanceEvolution(ran, [], later(2)).dex.encounter).toBe(null)
  // 최종 진화형(이상해꽃)을 만들어도 다시 나타나지 않는다
  const grown = advanceEvolution({ ...ran, box: [...ran.box, entry('b', 2, 0)], lead: 'b', xp: XP_PER_EVOLUTION_MS }, [], later(3)).dex
  expect(grown.encounter).toBe(null)
  // 알에서 나온 포켓몬이 박스에 들어오면(박스에 들어온 시각이 지금이면) 다시 나타난다
  const hatched = advanceEvolution({ ...grown, box: [entry('n', 16, later(4)), ...grown.box] }, [], later(4)).dex
  expect(hatched.encounter?.species).toBe(150)
  const all = Array.from({ length: 149 }, (_, i) => i + 1)
  const mew = advanceEvolution(dexOf({ box: [entry('a', 150)], seen: all, legends: [150] }), [], NOW).dex
  expect(mew.encounter?.species).toBe(151)
})

test('전설 둘이 한꺼번에 조건을 채우면 하나는 기다렸다가, 앞의 전설을 잡거나 놓치고 장면이 끝나면 이어서 나타난다', () => {
  // 리자몽 진화로 파이어 조건을, 리자몽이 100번째 종이라 뮤츠 조건을 함께 채운다
  const ninetyNine = Array.from({ length: 99 }, (_, i) => i + 1).map(n => (n === 6 ? 100 : n))
  const met = advanceEvolution(dexOf({ box: [entry('c', 5)], seen: ninetyNine, xp: XP_PER_EVOLUTION_MS }), [], NOW).dex
  expect(met.encounter?.species).toBe(146)
  expect(met.waiting).toEqual([150])
  const caught = advanceEvolution(met, [], NOW + 1000, null, 'throw').dex
  expect(caught.encounter).toBe(null)
  // 잡는 장면이 끝날 때까지는 나타나지 않는다
  expect(advanceEvolution(caught, [], NOW + 1000 + SCENE_GAP_MS - 1).dex.encounter).toBe(null)
  const next = advanceEvolution(caught, [], NOW + 1000 + SCENE_GAP_MS).dex
  expect(next.encounter?.species).toBe(150)
  expect(next.waiting).toEqual([])
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
  expect(old.scene).toBe(null)
  expect(old.encounter).toBe(null)
  expect(old.fled).toBe(null)
  expect(old.escaped).toEqual([])
  expect(old.waiting).toEqual([])
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

test('권한 창이나 질문으로 나를 기다리는 세션은 진행 중이어도 경험치를 쌓지 않는다', () => {
  const asking = session('q', { attention: { kind: 'permission', since: NOW - 60_000, text: 'Bash' } })
  const { dex } = advanceEvolution(dexOf({ xpAt: NOW - 60_000 }), [session('a'), asking], NOW)
  expect(dex.xp).toBe(60_000)
})

test('시계가 뒤로 가도 경험치는 줄지 않고 막대도 깨지지 않는다', () => {
  const { dex } = advanceEvolution(dexOf({ xp: 0, xpAt: NOW + 400 }), [session('a')], NOW)
  expect(dex.xp).toBe(0)
  expect(xpBar(-400)).toBe('░░░░░')
  expect(parsePokedex(JSON.stringify({ xp: -5 })).xp).toBe(0)
})
