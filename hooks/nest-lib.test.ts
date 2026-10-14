import { expect, test } from 'claude-code/testing'

import type { DexEgg, HeldEgg, Pokedex, SessionStatus } from '../types'
import {
  advancePokedex,
  boxOnPage,
  boxPageOf,
  boxPageOfKey,
  boxPages,
  boxPerRow,
  CELEBRATE_MS,
  DAILY_EGGS,
  drawBoxTile,
  drawPortrait,
  drawNest,
  eggSprite,
  eggsOf,
  emptyPokedex,
  EVOLVE_MS,
  freshEggs,
  keeperOf,
  LEAD_STAR,
  localDay,
  nestRows,
  parsePokedex,
  speciesOf,
  speciesToLoad,
  TILE,
  updatePending,
} from './nest-lib'
import type { SpriteLookup } from './nest-lib'
import { EGG_SPECIES } from './dex-data'

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
  // MR 상태는 따로 적지 않으면 지금 브랜치를 보고 적은 것이다
  mrBranch: 'mrBranch' in patch ? patch.mrBranch : (patch.branch === undefined ? `feat/${id}` : patch.branch),
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

const held = (key: string, species = 25): HeldEgg => ({ key, species })
// 오늘 이미 채운 기록. 자정 채우기가 끼어들지 않게 day 를 NOW 의 날짜로 둔다
const dexOf = (patch: Partial<Pokedex> = {}): Pokedex => ({ ...emptyPokedex(), day: localDay(NOW), daycare: [], ...patch })

test('브랜치에 이슈 번호가 있으면 알 이름은 이슈 번호다', () => {
  expect(eggsOf([session('a', { branch: 'feat/#ENA-12-login' })], emptyPokedex(), NOW)[0]!.label).toBe('#ENA-12')
})

test('열린 세션 중 알을 든 세션은 MR 에 따라 금이 가거나 부화하고, 알 없는 세션은 빈 둥지다', () => {
  const sessions = [
    session('a'),
    session('b', { mrState: 'opened' }),
    session('c', { mrState: 'merged' }),
    session('d', { ...closed }),
    session('e', { branch: 'main' }),
  ]
  const dex = dexOf({ holds: { a: held('a'), b: held('b'), c: held('c'), d: held('d') } })
  const eggs = eggsOf(sessions, dex, NOW)
  expect(eggs.map(egg => [egg.label, egg.stage])).toEqual([
    ['feat/a', 'egg'],
    ['feat/b', 'cracked'],
    ['feat/c', 'hatched'],
    ['momochi', 'empty'],
  ])
})

test('알 없는 세션은 빈 둥지로 보이고, 스프라이트를 불러오지 않는다', () => {
  const eggs = eggsOf([session('a', { state: 'working' })], dexOf(), NOW)
  expect(eggs.map(egg => [egg.key, egg.stage, egg.isShaking, egg.activity])).toEqual([['a', 'empty', false, 'working']])
  expect(speciesToLoad({ eggs, daycare: [], box: [], boxPage: 0 }, 40)).toEqual([])
})

test('대시보드로 표시한 세션만 알이 없고, 알을 든 세션만 닫힐 때 키우미집에 간다', () => {
  const sessions = [session('a', { prompt: null }), session('b', { isDashboard: true }), session('c')]
  expect(eggsOf(sessions, emptyPokedex(), NOW).map(egg => egg.key)).toEqual(['a', 'c'])
  const dex = dexOf({ holds: { a: held('a'), c: held('c') } })
  const gone = advancePokedex(dex, sessions.map(one => ({ ...one, ...closed })), NOW)
  expect(gone.dex.daycare.map(egg => egg.key).sort()).toEqual(['a', 'c'])
})

test('iTerm2 리뷰 세션은 알이 없고, 알을 든 세션만 닫힐 때 키우미집에 간다', () => {
  const sessions = [session('a'), session('r', { prompt: 'Review the pending changes in this repo. Flag…' })]
  expect(eggsOf(sessions, emptyPokedex(), NOW).map(egg => egg.key)).toEqual(['a'])
  const gone = advancePokedex(dexOf({ holds: { a: held('a') } }), sessions.map(one => ({ ...one, ...closed })), NOW)
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
  const dex = dexOf({ holds: { a: held('a'), b: held('b'), c: held('c') } })
  expect(eggsOf(sessions, dex, NOW).map(egg => egg.isShaking)).toEqual([true, false, false])
})

test('같은 알은 늘 같은 포켓몬이고, 알이 다르면 알에서 나오는 74종에 고르게 퍼진다', () => {
  expect(speciesOf('abc')).toBe(speciesOf('abc'))
  const seen = new Set(Array.from({ length: 2000 }, (_, i) => speciesOf(`session-${i}`)))
  expect([...seen].every(species => EGG_SPECIES.includes(species))).toBe(true)
  expect(seen.size).toBeGreaterThan(60)
})

test('열린 세션 중 id 가 가장 작은 세션 하나만 기록을 쓴다', () => {
  expect(keeperOf([session('b'), session('a', { ...closed }), session('c')], NOW)).toBe('b')
  expect(keeperOf([session('a', { ...closed })], NOW)).toBe(null)
})

test('열린 세션의 MR 이 처음 머지되면 한 번만 부화한다', () => {
  const sessions = [session('a', { mrState: 'merged' }), session('b')]
  const first = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), sessions, NOW)
  expect(first.born.map(egg => egg.key)).toEqual(['egg-a'])
  expect(first.dex.hatched['egg-a']).toBe(NOW)
  expect(advancePokedex(first.dex, sessions, NOW + 1).born).toEqual([])
})

test('MR 없이 닫힌 세션의 알은 키우미집으로 가고, 한 번만 맡긴다', () => {
  const sessions = [session('a', { ...closed })]
  const first = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), sessions, NOW)
  expect(first.left.map(egg => egg.label)).toEqual(['feat/a'])
  expect(first.dex.daycare).toEqual([held('egg-a')])
  const again = advancePokedex(first.dex, sessions, NOW + 1)
  expect(again.left).toEqual([])
  expect(again.dex.daycare.length).toBe(1)
})

test('닫힌 것으로 본 세션이 잠자기에서 돌아오면 키우미집에 간 자기 알을 되찾는다', () => {
  const asleep = session('a', { updatedAt: NOW - 2 * 60 * 60 * 1000 })
  const gone = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [asleep], NOW).dex
  expect(gone.daycare.map(egg => egg.key)).toEqual(['egg-a'])
  const back = advancePokedex(gone, [session('a')], NOW + 1).dex
  expect(back.daycare).toEqual([])
  expect(back.done).toEqual([])
})

test('/clear 로 이어진 세션은 끝난 세션의 알을 물려받고, 키우미집에 보내지 않는다', () => {
  const start = dexOf({ holds: { old: held('egg-old', 133) } })
  const live = advancePokedex(start, [session('old', { branch: 'main', mrState: 'merged' })], NOW).dex
  const sessions = [
    session('old', { branch: 'main', state: 'ended', endReason: 'clear', mrState: 'merged' }),
    session('new', { branch: 'main', predecessor: 'old' }),
  ]
  const after = advancePokedex(live, sessions, NOW + 1)
  expect(after.left).toEqual([])
  expect(after.dex.daycare).toEqual([])
  expect(after.dex.holds).toEqual({ new: held('egg-old', 133) })
  expect(after.dex.hatched['egg-old']).toBe(NOW)
  expect(eggsOf(sessions, after.dex, NOW + 1).map(egg => [egg.key, egg.species])).toEqual([['egg-old', 133]])
})

test('/clear 로 끝난 세션은 이어 받을 세션을 잠깐 기다리고, 끝내 안 오면 키우미집에 간다', () => {
  const ended = session('old', { state: 'ended', endReason: 'clear', updatedAt: NOW })
  const dex = dexOf({ holds: { old: held('egg-old') } })
  expect(advancePokedex(dex, [ended], NOW + 1).left).toEqual([])
  expect(advancePokedex(dex, [ended], NOW + 3 * 60 * 1000).left.map(egg => egg.key)).toEqual(['egg-old'])
})

test('MR 이 열린 채 닫힌 세션의 알은 금 간 채 남아 머지를 기다린다', () => {
  const first = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [session('a', { ...closed, mrState: 'opened' })], NOW)
  expect(first.dex.pending.map(egg => egg.key)).toEqual(['egg-a'])
  expect(eggsOf([], first.dex, NOW).map(egg => egg.stage)).toEqual(['cracked'])
})

test('기다리던 MR 이 머지되면 부화해 잠깐 뛰다가 박스로 간다', () => {
  const sessions = [session('a', { ...closed, mrState: 'opened' })]
  const waiting = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), sessions, NOW).dex
  const merged = advancePokedex(updatePending(waiting, 'egg-a', 'merged'), sessions, NOW + 1)
  expect(merged.born.map(egg => egg.key)).toEqual(['egg-a'])
  expect(merged.boxed).toEqual([])
  expect(eggsOf([], merged.dex, NOW + 1).map(egg => egg.stage)).toEqual(['hatched'])
  const later = advancePokedex(merged.dex, sessions, NOW + 1 + CELEBRATE_MS)
  expect(later.boxed.map(egg => egg.key)).toEqual(['egg-a'])
  expect(later.dex.box.map(egg => egg.key)).toEqual(['egg-a'])
  expect(later.dex.pending).toEqual([])
})

test('부화한 세션이 닫히면 바로 박스로 간다', () => {
  const live = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [session('a', { mrState: 'merged' })], NOW).dex
  const after = advancePokedex(live, [session('a', { ...closed, mrState: 'merged' })], NOW + CELEBRATE_MS)
  expect(after.boxed.map(egg => egg.key)).toEqual(['egg-a'])
})

test('박스로 보낸 세션은 빈 세션이 되고, 진행 중이 되면 새 알을 받지만 같은 브랜치의 머지로는 깨지지 않는다', () => {
  const sessions = [session('a', { mrState: 'merged' }), session('b')]
  const hatchedDex = advancePokedex(dexOf({ holds: { a: held('egg-a'), b: held('egg-b') } }), sessions, NOW).dex
  const sent = advancePokedex(hatchedDex, sessions, NOW + 1, ['egg-a', 'egg-b'])
  expect(sent.boxed.map(egg => egg.key)).toEqual(['egg-a'])
  expect(sent.dex.box.map(egg => egg.key)).toEqual(['egg-a'])
  expect(sent.dex.holds.a).toBeUndefined()
  expect(sent.dex.sent.a).toBe('feat/a')
  const working = advancePokedex({ ...sent.dex, daycare: [held('next')] }, [session('a', { state: 'working', mrState: 'merged' })], NOW + 2)
  expect(working.given.map(egg => egg.key)).toEqual(['next'])
  expect(working.born).toEqual([])
})

test('박스로 보낸 세션이 다른 브랜치로 옮겨 받은 알은 MR 이 열리면 금이 간다', () => {
  const merged = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [session('a', { mrState: 'merged' })], NOW).dex
  const sent = advancePokedex(merged, [session('a', { mrState: 'merged' })], NOW + 1, ['egg-a']).dex
  const moved = [session('a', { state: 'working', branch: 'feat/next', mrState: 'opened' })]
  const got = advancePokedex({ ...sent, daycare: [held('next')] }, moved, NOW + 2).dex
  expect(eggsOf(moved, got, NOW + 2).map(egg => [egg.key, egg.stage])).toEqual([['next', 'cracked']])
})

test('닫힌 뒤 부화해 뛰고 있는 알도 박스로 보내기를 누르면 바로 간다', () => {
  const sessions = [session('a', { ...closed, mrState: 'merged' })]
  const waiting = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), sessions, NOW).dex
  expect(waiting.pending.length).toBe(1)
  const sent = advancePokedex(waiting, sessions, NOW + 1, ['egg-a'])
  expect(sent.boxed.map(egg => egg.key)).toEqual(['egg-a'])
  expect(sent.dex.pending).toEqual([])
})

test('기다리던 MR 이 머지 없이 닫히면 키우미집으로 간다', () => {
  const sessions = [session('a', { ...closed, mrState: 'opened' })]
  const waiting = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), sessions, NOW).dex
  const after = advancePokedex(updatePending(waiting, 'egg-a', 'closed'), sessions, NOW + 1)
  expect(after.left.map(egg => egg.key)).toEqual(['egg-a'])
  expect(after.dex.daycare).toEqual([held('egg-a')])
})

test('깨진 기록 파일은 빈 기록으로 읽는다', () => {
  expect(parsePokedex('{oops')).toEqual(emptyPokedex())
  expect(parsePokedex('{"box": 3}')).toEqual(emptyPokedex())
})

test('옛 기록을 읽으면 오늘 알 7개로 채우고 갇힌 알은 버린다', () => {
  const old = parsePokedex(JSON.stringify({ daycare: [dexEgg('x', { branch: 'develop' })], claims: { a: 3 }, sent: { a: { count: 1, branch: 'feat/a' } } }))
  expect(old.day).toBe('')
  expect(old.holds).toEqual({})
  const after = advancePokedex(old, [], NOW).dex
  expect(after.day).toBe(localDay(NOW))
  expect(after.daycare).toEqual(freshEggs(localDay(NOW)))
  expect(after.daycare.length).toBe(DAILY_EGGS)
})

test('자정이 지나면 키우미집만 새 알 7개로 바꾼다', () => {
  const night = new Date(2026, 9, 14, 23, 59).getTime()
  const morning = new Date(2026, 9, 15, 0, 1).getTime()
  const dex = { ...emptyPokedex(), day: localDay(night), daycare: [held('left')], holds: { a: held('mine') },
    pending: [{ ...dexEgg('wait'), mrState: 'opened' }] }
  const after = advancePokedex(dex, [session('a', { updatedAt: morning })], morning).dex
  expect(after.daycare).toEqual(freshEggs('2026-10-15'))
  expect(after.holds.a).toEqual(held('mine'))
  expect(after.pending.map(egg => egg.key)).toEqual(['wait'])
})

test('알 없는 세션은 진행 중일 때만 키우미집에서 알을 받는다', () => {
  const dex = dexOf({ daycare: [held('d1'), held('d2')] })
  const after = advancePokedex(dex, [session('a', { state: 'working' }), session('b')], NOW)
  expect(after.given.map(egg => [egg.key, egg.label])).toEqual([['d1', 'feat/a']])
  expect(after.dex.holds).toEqual({ a: held('d1') })
  expect(after.dex.daycare).toEqual([held('d2')])
})

test('키우미집이 비면 진행 중이어도 알을 받지 못한다', () => {
  const after = advancePokedex(dexOf(), [session('a', { state: 'working' })], NOW)
  expect(after.given).toEqual([])
  expect(after.dex.holds).toEqual({})
})

test('알이 모자라면 먼저 일을 시작한 세션부터 받는다', () => {
  const sessions = [session('a', { state: 'working', workingSince: NOW - 10 }), session('b', { state: 'working', workingSince: NOW - 99 })]
  const after = advancePokedex(dexOf({ daycare: [held('only')] }), sessions, NOW)
  expect(after.dex.holds).toEqual({ b: held('only') })
})

test('닫힌 세션이 돌려준 알을 진행 중인 빈 세션이 바로 받는다', () => {
  const dex = dexOf({ holds: { a: held('egg-a', 133) } })
  const after = advancePokedex(dex, [session('a', { ...closed }), session('b', { state: 'working' })], NOW)
  expect(after.left.map(egg => egg.key)).toEqual(['egg-a'])
  expect(after.dex.holds.b).toEqual(held('egg-a', 133))
  expect(after.dex.daycare).toEqual([])
  expect(eggsOf([session('b', { state: 'working' })], after.dex, NOW)[0]!.species).toBe(133)
})

test('이미 머지된 브랜치에서 받은 알은 그 머지로 깨지지 않고, 다른 브랜치의 다음 머지로 깨진다', () => {
  const dex = dexOf({ daycare: [held('d1')] })
  const got = advancePokedex(dex, [session('a', { state: 'working', mrState: 'merged' })], NOW)
  expect(got.born).toEqual([])
  expect(got.dex.sent.a).toBe('feat/a')
  const next = advancePokedex(got.dex, [session('a', { branch: 'feat/next', mrState: 'merged' })], NOW + 1)
  expect(next.born.map(egg => egg.key)).toEqual(['d1'])
})

test('알 없는 세션은 MR 이 머지돼도 아무것도 나오지 않는다', () => {
  const after = advancePokedex(dexOf(), [session('a', { mrState: 'merged' })], NOW)
  expect(after.born).toEqual([])
  expect(after.dex.hatched).toEqual({})
})

test('알 없는 세션이 닫히면 아무 일도 없다', () => {
  const after = advancePokedex(dexOf(), [session('a', { ...closed })], NOW)
  expect(after.left).toEqual([])
  expect(after.dex.daycare).toEqual([])
})

test('잠자기에서 돌아온 세션은 남아 있는 자기 알만 되찾는다', () => {
  const asleep = session('a', { updatedAt: NOW - 2 * 60 * 60 * 1000 })
  const gone = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [asleep], NOW).dex
  expect(gone.daycare).toEqual([held('egg-a')])
  expect(advancePokedex(gone, [session('a')], NOW + 1).dex.holds.a).toEqual(held('egg-a'))
  // 그 사이 다른 세션이 받아 갔으면 빈 세션으로 돌아온다
  const taken = advancePokedex(gone, [asleep, session('b', { state: 'working' })], NOW + 1).dex
  const back = advancePokedex(taken, [session('a'), session('b', { state: 'working' })], NOW + 2).dex
  expect(back.holds).toEqual({ b: held('egg-a') })
})

test('다른 세션이 받아 간 알은 그 세션이 닫혀 머지를 기다려도 잠자기에서 돌아온 세션이 가져가지 않는다', () => {
  const asleep = session('a', { updatedAt: NOW - 2 * 60 * 60 * 1000 })
  const gone = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [asleep], NOW).dex
  const taken = advancePokedex(gone, [asleep, session('b', { state: 'working' })], NOW + 1).dex
  expect(taken.holds).toEqual({ b: held('egg-a') })
  const waiting = advancePokedex(taken, [asleep, session('b', { ...closed, mrState: 'opened' })], NOW + 2).dex
  expect(waiting.pending.map(egg => egg.key)).toEqual(['egg-a'])
  const back = advancePokedex(waiting, [session('a', { updatedAt: NOW + 3 }), session('b', { ...closed, mrState: 'opened' })], NOW + 3).dex
  expect(back.pending.map(egg => egg.key)).toEqual(['egg-a'])
  expect(back.holds.a).toBeUndefined()
})

test('/clear 로 이어진 세션이 이미 알을 들고 있으면 끝난 세션의 알은 키우미집으로 돌아간다', () => {
  const sessions = [
    session('old', { state: 'ended', endReason: 'clear' }),
    session('new', { predecessor: 'old' }),
  ]
  const after = advancePokedex(dexOf({ holds: { old: held('egg-old'), new: held('egg-new') } }), sessions, NOW)
  expect(after.dex.holds).toEqual({ new: held('egg-new') })
  expect(after.dex.daycare).toEqual([held('egg-old')])
  expect(after.left.map(egg => egg.key)).toEqual(['egg-old'])
})

test('/clear 로 이어진 세션이 이미 알을 들고 있어도 끝난 세션의 부화한 포켓몬은 박스로 간다', () => {
  const live = advancePokedex(
    dexOf({ holds: { old: held('egg-old'), new: held('egg-new') } }),
    [session('old', { mrState: 'merged' }), session('new', { predecessor: 'old' })],
    NOW,
  ).dex
  expect(live.hatched['egg-old']).toBe(NOW)
  const sessions = [
    session('old', { state: 'ended', endReason: 'clear', mrState: 'merged' }),
    session('new', { predecessor: 'old' }),
  ]
  const after = advancePokedex(live, sessions, NOW + 1)
  expect(after.dex.daycare).toEqual([])
  expect(after.dex.pending.map(egg => [egg.key, egg.mrState])).toEqual([['egg-old', 'merged']])
  const later = advancePokedex(after.dex, sessions, NOW + CELEBRATE_MS)
  expect(later.dex.box.map(egg => egg.key)).toEqual(['egg-old'])
})

test('알을 받은 뒤 대시보드로 표시한 세션은 알을 키우미집에 돌려준다', () => {
  const after = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [session('a', { isDashboard: true })], NOW)
  expect(after.dex.holds).toEqual({})
  expect(after.dex.daycare).toEqual([held('egg-a')])
  expect(after.left.map(egg => egg.key)).toEqual(['egg-a'])
})

test('부화했다가 키우미집에 돌아간 알은 다음 세션이 받아 부화하면 다시 탄생을 알린다', () => {
  const live = advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [session('a', { mrState: 'merged' })], NOW).dex
  expect(live.hatched['egg-a']).toBe(NOW)
  // 머지 없는 브랜치로 옮겨 닫으면 알은 키우미집으로 간다
  const gone = advancePokedex(live, [session('a', { ...closed, branch: 'feat/other', mrState: null })], NOW + 1).dex
  expect(gone.daycare).toEqual([held('egg-a')])
  expect(gone.hatched).toEqual({})
  const got = advancePokedex(gone, [session('b', { state: 'working' })], NOW + 2).dex
  const born = advancePokedex(got, [session('b', { mrState: 'merged' })], NOW + 3)
  expect(born.born.map(egg => egg.key)).toEqual(['egg-a'])
  expect(born.dex.hatched['egg-a']).toBe(NOW + 3)
})

test('어디에도 없는 알의 부화 기록은 지운다', () => {
  const after = advancePokedex(dexOf({ hatched: { lost: NOW } }), [], NOW)
  expect(after.dex.hatched).toEqual({})
})

test('MR 상태가 지금 브랜치의 것인지 모르면 알을 주지 않고, 알게 되면 이미 머지된 브랜치의 알은 깨지지 않는다', () => {
  const dex = dexOf({ daycare: [held('next')] })
  // 이미 머지된 브랜치에서 새로 연 세션. MR 상태를 아직 조회하지 않았다
  const unknown = advancePokedex(dex, [session('a', { state: 'working', branch: 'feat/done', mrBranch: undefined })], NOW)
  expect(unknown.dex.holds).toEqual({})
  expect(unknown.given).toEqual([])
  // 다른 브랜치를 보고 적은 MR 상태도 모르는 것으로 친다
  const stale = advancePokedex(dex, [session('a', { state: 'working', branch: 'feat/done', mrState: null, mrBranch: 'feat/old' })], NOW)
  expect(stale.dex.holds).toEqual({})
  const known = [session('a', { state: 'working', branch: 'feat/done', mrState: 'merged' })]
  const got = advancePokedex(unknown.dex, known, NOW + 1)
  expect(got.dex.holds).toEqual({ a: held('next') })
  const later = advancePokedex(got.dex, known, NOW + 2)
  expect(later.born).toEqual([])
  expect(eggsOf(known, later.dex, NOW + 2)[0]!.stage).toBe('egg')
})

test('다른 브랜치를 보고 적은 머지는 지금 든 알을 깨지 않는다', () => {
  const sessions = [session('a', { branch: 'feat/b', mrState: 'merged', mrBranch: 'feat/a' })]
  const dex = dexOf({ holds: { a: held('egg-a') } })
  expect(advancePokedex(dex, sessions, NOW).born).toEqual([])
  expect(eggsOf(sessions, dex, NOW)[0]!.stage).toBe('egg')
  // 닫혀도 머지된 것으로 치지 않는다
  expect(advancePokedex(dex, sessions.map(one => ({ ...one, ...closed })), NOW).dex.daycare).toEqual([held('egg-a')])
})

test('브랜치를 적지 않은 옛 상태 파일의 MR 상태는 알을 깨는 데는 믿지만, 알을 주지는 않는다', () => {
  const legacy = session('a', { state: 'working', mrState: 'merged', mrBranch: undefined })
  expect(advancePokedex(dexOf({ holds: { a: held('egg-a') } }), [legacy], NOW).born.map(egg => egg.key)).toEqual(['egg-a'])
  expect(advancePokedex(dexOf({ daycare: [held('next')] }), [legacy], NOW).dex.holds).toEqual({})
})

test('금 간 알과 부화한 알, 박스 이번 페이지의 포켓몬만 스프라이트를 불러온다', () => {
  const dex = dexOf({ holds: { a: held('a', 1), b: held('b', 2), c: held('c', 3) } })
  const eggs = eggsOf([session('a'), session('b', { mrState: 'opened' }), session('c', { mrState: 'merged' })], dex, NOW)
  const box = [dexEgg('k', { species: 150 })]
  expect(speciesToLoad({ eggs, daycare: [], box, boxPage: 0 }, 80)).toEqual([eggs[1]!.species, eggs[2]!.species, 150])
})

test('그림은 알 줄과 키우미집을 합친 줄 수만큼 칸을 채우고 프레임마다 움직인다', () => {
  const dex = dexOf({ holds: { a: held('a'), b: held('b') } })
  const eggs = eggsOf([session('a', { state: 'working' }), session('b', { mrState: 'merged' })], dex, NOW)
  const input = { eggs, daycare: [held('d')], box: [dexEgg('k')], boxPage: 0 }
  const width = 40
  const none: SpriteLookup = () => undefined
  const cells = drawNest(input, width, 1, NOW, none)
  expect(cells.length).toBe(width * nestRows(input, width) * 3)
  expect(drawNest(input, width, 1, NOW, none)).toEqual(cells)
  expect(drawNest(input, width, 2, NOW, none)).not.toEqual(cells)
  expect(nestRows({ ...input, daycare: [] }, width)).toBe(nestRows(input, width))
})

test('알 줄과 키우미집 그림에는 PC BOX 가 들어가지 않는다', () => {
  const empty = { eggs: [], daycare: [], box: [], boxPage: 0 }
  const full = { ...empty, box: Array.from({ length: 9 }, (_, i) => dexEgg(`k${i}`)) }
  expect(nestRows(full, 40)).toBe(nestRows(empty, 40))
  expect(drawNest(full, 40, 1, NOW, () => undefined)).toEqual(drawNest(empty, 40, 1, NOW, () => undefined))
})
test('스프라이트를 불러오면 몬스터볼 대신 그 그림을 그린다', () => {
  const dot: SpriteLookup = () => ({ width: 1, height: 1, px: [0x123456] })
  const withDot = drawBoxTile(dexEgg('k'), false, null, 0, NOW, dot)
  expect(withDot).not.toEqual(drawBoxTile(dexEgg('k'), false, null, 0, NOW, () => undefined))
  expect(Array.from(withDot).includes(0x123456)).toBe(true)
})

test('박스 칸은 18점 아이콘을 그리고 앞장이면 별을 단다', () => {
  const sizes: number[] = []
  const big: SpriteLookup = (_, size) => {
    sizes.push(size)
    return { width: 1, height: 1, px: [0x123456] }
  }
  const plain = drawBoxTile(dexEgg('k'), false, null, 0, NOW, big)
  expect(sizes).toEqual([18])
  expect(plain.length).toBe(TILE * (TILE / 2) * 3)
  const lead = drawBoxTile(dexEgg('k'), true, null, 0, NOW, big)
  expect(Array.from(plain).includes(LEAD_STAR)).toBe(false)
  expect(Array.from(lead).includes(LEAD_STAR)).toBe(true)
  // 빈 칸은 벽만 그린다
  expect(Array.from(drawBoxTile(null, false, null, 0, NOW, big)).includes(0x123456)).toBe(false)
})

test('막 진화한 칸은 진화 전과 지금 그림을 번갈아 그리고 잠시 뒤 멈춘다', () => {
  const bySpecies: SpriteLookup = species => ({ width: 1, height: 1, px: [species === 19 ? 0x111111 : 0x222222] })
  const entry = dexEgg('k', { species: 20 })
  const evolving = { key: 'k', from: 19, at: NOW }
  const frames = [0, 1, 2, 3].map(frame => drawBoxTile(entry, false, evolving, frame, NOW, bySpecies))
  expect(frames.some(cells => Array.from(cells).includes(0x111111))).toBe(true)
  expect(frames.some(cells => Array.from(cells).includes(0x222222))).toBe(true)
  const later = [0, 1, 2, 3].map(frame => drawBoxTile(entry, false, evolving, frame, NOW + EVOLVE_MS + 1, bySpecies))
  expect(later.every(cells => Array.from(cells).includes(0x222222) && !Array.from(cells).includes(0x111111))).toBe(true)
  // 다른 칸의 진화는 이 칸을 바꾸지 않는다
  const other = drawBoxTile(dexEgg('o', { species: 20 }), false, evolving, 0, NOW, bySpecies)
  expect(Array.from(other).includes(0x111111)).toBe(false)
})
test('빈 둥지는 둥지 바닥만 그리고 알은 그리지 않는다', () => {
  const nest = { key: 'a', label: 'a', species: 0, isShaking: false, activity: null, hatchedAt: null }
  const empty = { eggs: [{ ...nest, stage: 'empty' as const }], daycare: [], box: [], boxPage: 0 }
  const egg = { ...empty, eggs: [{ ...nest, stage: 'egg' as const }] }
  const none: SpriteLookup = () => undefined
  const cells = drawNest(empty, 40, 1, NOW, none)
  expect(cells.length).toBe(40 * nestRows(empty, 40) * 3)
  expect(cells).not.toEqual(drawNest(egg, 40, 1, NOW, none))
  // 흔들리는 세션이어도 빈 둥지는 그릴 알이 없어 프레임마다 그대로다
  const shaking = { ...empty, eggs: [{ ...nest, stage: 'empty' as const, isShaking: true }] }
  expect(drawNest(shaking, 40, 2, NOW, none)).toEqual(drawNest(shaking, 40, 1, NOW, none))
  // 알 그림의 색은 빈 둥지에 없다
  const seen = new Set(Array.from(cells))
  expect(Array.from(drawNest(egg, 40, 1, NOW, none)).some(value => !seen.has(value))).toBe(true)
})

test('키우미집은 알이 0개여도 보인다', () => {
  const empty = { eggs: [], daycare: [], box: [], boxPage: 0 }
  expect(nestRows(empty, 40)).toBe(6)
})

test('박스는 한 페이지에 한 줄이고 넘치면 페이지를 나눈다', () => {
  // 폭 60 은 한 줄에 세 마리
  const box = Array.from({ length: 7 }, (_, i) => ({ ...dexEgg(`k${i}`), species: i + 1 }))
  const first = { eggs: [], daycare: [], box, boxPage: 0 }
  expect(boxPerRow(60)).toBe(3)
  expect(boxPages(first, 60)).toBe(3)
  expect(boxOnPage(first, 60).map(entry => entry.species)).toEqual([1, 2, 3])
  expect(speciesToLoad(first, 60)).toEqual([1, 2, 3])
  expect(speciesToLoad({ ...first, boxPage: 2 }, 60)).toEqual([7])
  expect(boxPageOfKey(first, 60, 'k4')).toBe(1)
  // 박스가 줄어 페이지가 사라지면 마지막 페이지로 당긴다
  expect(boxPageOf({ ...first, boxPage: 5 }, 60)).toBe(2)
  // 막 진화한 칸이 이 페이지에 있으면 진화 전 그림도 불러온다
  expect(speciesToLoad({ ...first, evolving: { key: 'k1', from: 99, at: NOW } }, 60)).toEqual([1, 2, 3, 99])
})
test('금 간 알은 알마다 다섯 가지 금 중 하나로 그리고, 같은 알은 늘 같은 금이다', () => {
  const crackOf = (key: string) =>
    eggSprite(key, 'cracked', 0)
      .flatMap((row, y) => [...row].map((c, x) => (c === 'c' ? `${x},${y}` : null)))
      .filter(Boolean)
      .join(' ')
  expect(crackOf('a')).toBe(crackOf('a'))
  expect(new Set(Array.from({ length: 40 }, (_, i) => crackOf(`egg-${i}`))).size).toBe(5)
})

test('알은 14x13 몸통에 여섯 무늬 중 하나로 그리고, 같은 알은 늘 같은 무늬다', () => {
  expect(eggSprite('a', 'egg', 0)).toEqual(eggSprite('a', 'egg', 0))
  expect(new Set(Array.from({ length: 200 }, (_, i) => eggSprite(`egg-${i}`, 'egg', 0).join('\n'))).size).toBe(6)
  // 서 있는 알은 폭 14, 키 13 이다
  const rows = eggSprite('a', 'egg', 0)
  const painted = rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' ? [] : [[x, y] as const])))
  expect(Math.max(...painted.map(([x]) => x)) - Math.min(...painted.map(([x]) => x)) + 1).toBe(14)
  expect(Math.max(...painted.map(([, y]) => y)) - Math.min(...painted.map(([, y]) => y)) + 1).toBe(13)
})

test('기운 알도 외곽선에 구멍이 없고 바닥이 둥지에 닿으며 잘리지 않는다', () => {
  for (const angle of [0, -25, -15, -10, 10, 15, 25]) {
    const rows = eggSprite('egg-3', 'egg', angle)
    const at = (x: number, y: number) => rows[y]?.[x] ?? '.'
    expect(rows[rows.length - 1]!.includes('k')).toBe(true)
    expect(rows[0]!.replace(/\./g, '')).toBe('')
    expect(rows.every(row => row[0] === '.' && row[row.length - 1] === '.')).toBe(true)
    rows.forEach((row, y) =>
      [...row].forEach((c, x) => {
        const isEdge = c !== '.' && [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].includes('.')
        if (isEdge) {
          expect(c).toBe('k')
        }
      }),
    )
  }
})

test('금 간 알은 기울어도 금이 보인다', () => {
  expect(eggSprite('egg-1', 'cracked', 25).some(row => row.includes('c'))).toBe(true)
  expect(eggSprite('egg-1', 'cracked', -25).some(row => row.includes('c'))).toBe(true)
})

test('원본 그림은 줄이지 않고 반 블록으로 그린다', () => {
  const sizes: number[] = []
  const big: SpriteLookup = (_, size) => {
    sizes.push(size)
    return { width: 30, height: 24, px: Array.from({ length: 30 * 24 }, () => 0x123456) }
  }
  const portrait = drawPortrait(25, big)!
  expect(portrait.columns).toBe(30)
  expect(portrait.rows).toBe(12)
  expect(portrait.cells.length).toBe(30 * 12 * 3)
  expect(sizes[0]).toBeGreaterThanOrEqual(40)
  expect(drawPortrait(25, () => undefined)).toBe(null)
})

test('기운 알에는 한 칸짜리 돌기가 없다', () => {
  for (let i = 0; i < 12; i++) {
    for (const angle of [-25, -15, -10, 10, 15, 25]) {
      const rows = eggSprite(`egg-${i}`, 'egg', angle)
      const filled = (x: number, y: number) => (rows[y]?.[x] ?? '.') !== '.'
      rows.forEach((row, y) =>
        [...row].forEach((c, x) => {
          if (c !== '.') {
            const neighbours = [filled(x - 1, y), filled(x + 1, y), filled(x, y - 1), filled(x, y + 1)].filter(Boolean).length
            expect(neighbours).toBeGreaterThanOrEqual(2)
          }
        }),
      )
    }
  }
})
