// 박스 포켓몬의 진화. 세션이 일한 시간이 경험치가 되고, 앞장선 포켓몬 한 마리만 먹는다
// 경험치가 차면 앞장선 포켓몬이 한 단계 진화하고, 진화로 정해진 최종 진화형을 처음 만들거나 도감을 채우면 전설이 박스에 온다
// 기록을 쓰는 세션이 advancePokedex 바로 뒤에 부른다

import type { BoxEntry, Pokedex, SessionStatus } from '../types'
import { canEvolve, EVOLUTIONS, LEGEND_FINALS, LEGENDS, MEWTWO_DEX } from './dex-data'
import { hash, hasEgg } from './nest-lib'
import { livenessOf } from './sessions-lib'

// 진화 한 번에 드는 일한 시간
export const XP_PER_EVOLUTION_MS = 3 * 60 * 60 * 1000
// 지난번 맞춘 뒤 이보다 오래 지났으면 잠자기나 모든 세션이 꺼진 시간으로 보고 세지 않는다
export const XP_GAP_MS = 5 * 60 * 1000
// 같은 종이 이만큼 모이면 자동으로 고를 때 그 종이 먼저 앞장선다
const CROWD = 3
// 키우미집에서 데려오기 요청. 맡길 포켓몬 key 대신 이 값을 보낸다
export const TAKE_BACK = '-'
// 야생 전설이 기다리는 시간. 지나면 달아난다
export const ENCOUNTER_MS = 60 * 60 * 1000
// 앞의 전설 장면이 끝나길 기다리는 시간. 차례를 기다리던 전설은 이만큼 지난 뒤 나타난다
export const SCENE_GAP_MS = 10 * 1000
// 야생 전설에게 하는 일. throw 는 몬스터볼 던지기, run 은 무시하기, dismiss 는 달아난 안내 닫기
export type EncounterAction = 'throw' | 'run' | 'dismiss'
const LEGEND_SPECIES: readonly number[] = Object.values(LEGENDS)

// 진화하면 될 종. 이브이처럼 갈라지면 칸 key 로 골라 다시 계산해도 같다
export function evolutionOf(entry: BoxEntry): number | null {
  const next = EVOLUTIONS[entry.species]
  if (!next) {
    return null
  }
  return next[hash(`evolve:${entry.key}`) % next.length]!
}

const firstCaught = (entries: readonly BoxEntry[]): BoxEntry | undefined =>
  entries.reduce<BoxEntry | undefined>((best, one) => (!best || one.at < best.at ? one : best), undefined)

// 아무도 고르지 않았을 때 앞장설 포켓몬. 같은 종이 3마리 이상이면 그 종이 먼저고, 그중 가장 먼저 잡은 포켓몬이다
export function autoLead(box: readonly BoxEntry[]): string | null {
  const able = box.filter(one => canEvolve(one.species))
  const counts = new Map<number, number>()
  for (const one of able) {
    counts.set(one.species, (counts.get(one.species) ?? 0) + 1)
  }
  const crowded = able.filter(one => (counts.get(one.species) ?? 0) >= CROWD)
  return firstCaught(crowded.length > 0 ? crowded : able)?.key ?? null
}

// pick 은 사용자가 Leave at DAY CARE 를 누른 박스 key, 또는 Take back 을 누른 TAKE_BACK
// evolved 는 이번에 진화한 칸과 진화 전 종, legends 는 이번에 박스에 들어온 전설
// action 은 야생 전설에게 누른 버튼
// legends 는 이번에 잡은 전설, fled 는 이번에 달아난 전설
export function advanceEvolution(
  dex: Pokedex,
  sessions: readonly SessionStatus[],
  now: number,
  pick: string | null = null,
  action: EncounterAction | null = null,
) {
  let box = [...dex.box]
  const seen = new Set([...dex.seen, ...box.map(one => one.species)])
  const legends = new Set([...dex.legends, ...box.map(one => one.species).filter(species => LEGEND_SPECIES.includes(species))])
  const evolved: Array<{ entry: BoxEntry; from: number }> = []
  const arrived: BoxEntry[] = []

  const able = (key: string | null) => box.find(one => one.key === key && canEvolve(one.species))
  let lead = dex.lead
  let chosen = dex.chosen
  if (pick === TAKE_BACK) {
    lead = null
    chosen = false
  } else if (pick !== null && box.some(one => one.key === pick)) {
    // 진화하지 않는 포켓몬(메타몽 등)과 최종 진화형도 맡길 수 있다. 맡긴 동안은 MAX 라 경험치가 쌓이지 않는다
    lead = pick
    chosen = true
  } else if (!box.some(one => one.key === lead)) {
    // 맡긴 포켓몬은 최종 진화형이 되어도 데려올 때까지 남는다. 박스에서 사라졌을 때만 다시 고른다
    lead = null
    chosen = false
  }
  lead ??= autoLead(box)

  // 최종 진화형이 맡겨져 있으면 더 진화할 수 없어 경험치를 쌓지 않는다
  let xp = dex.xp
  const isMaxed = lead !== null && !able(lead)
  if (!isMaxed && dex.xpAt > 0 && now - dex.xpAt <= XP_GAP_MS) {
    // 권한 창이나 질문으로 나를 기다리는 세션은 상태가 working 이어도 일하지 않는 것으로 친다
    const working = sessions.filter(session => hasEgg(session) && livenessOf(session, now) === 'working' && !session.attention).length
    // 기록을 쓰는 세션이 바뀌며 시계가 조금 어긋나도 경험치가 줄지 않게 한다
    xp += Math.max(0, now - dex.xpAt) * working
  }

  let evolving = dex.evolving
  const leader = able(lead)
  if (leader && xp >= XP_PER_EVOLUTION_MS) {
    const species = evolutionOf(leader)!
    const grown = { ...leader, species }
    box = box.map(one => (one.key === leader.key ? grown : one))
    seen.add(species)
    evolved.push({ entry: grown, from: leader.species })
    evolving = { key: leader.key, from: leader.species, at: now }
    xp = 0
  }

  let encounter = dex.encounter
  let scene = dex.scene
  let fled = dex.fled
  const escaped = new Set(dex.escaped)
  const waiting = [...dex.waiting]
  const gone: number[] = []
  const runAway = () => {
    if (encounter) {
      fled = { species: encounter.species }
      escaped.add(encounter.species)
      gone.push(encounter.species)
      encounter = null
    }
  }
  if (action === 'throw' && encounter) {
    const entry = { key: `legend:${encounter.species}`, species: encounter.species, root: encounter.root, branch: encounter.branch, label: encounter.label, at: now }
    box = [entry, ...box]
    legends.add(entry.species)
    seen.add(entry.species)
    escaped.delete(entry.species)
    arrived.push(entry)
    scene = { kind: 'catch', species: entry.species, at: now }
    encounter = null
  } else if (action === 'run' || (encounter && now - encounter.at >= ENCOUNTER_MS)) {
    runAway()
  }
  if (action === 'dismiss') {
    fled = null
  }

  // 전설은 박스에 바로 오지 않고 야생으로 나타난다. 잡은 전설은 다시 나타나지 않는다
  // 다른 전설이 나타나 있으면 차례를 기다린다. 저장소와 라벨은 진화한 칸, 없으면 박스 맨 앞 칸의 것을 쓴다
  const meet = (species: number) => {
    const from = evolved[0]?.entry ?? box[0]
    if (legends.has(species) || encounter?.species === species || !from) {
      return
    }
    // 다른 전설이 나타나 있거나 전설 장면이 아직 끝나지 않았으면 차례를 기다린다
    if (encounter || (scene && now - scene.at < SCENE_GAP_MS)) {
      if (!waiting.includes(species)) {
        waiting.push(species)
      }
      return
    }
    encounter = { species, at: now, root: from.root, branch: from.branch, label: from.label }
    scene = { kind: 'appear', species, at: now }
    escaped.delete(species)
    if (waiting.includes(species)) {
      waiting.splice(waiting.indexOf(species), 1)
    }
  }
  for (const [legend, finals] of Object.entries(LEGEND_FINALS)) {
    if (evolved.some(one => finals.includes(one.entry.species))) {
      meet(Number(legend))
    }
  }
  // 도감 조건은 한 번 채우면 계속 채워져 있어, 달아난 뒤에는 새 포켓몬이 박스에 들어올 때만 다시 나타난다
  // 박스에 막 들어온 칸은 들어온 시각이 지금이다(advancePokedex 가 같은 now 로 넣는다). 진화한 칸과 전설 칸은 시각이 그대로거나 전설이다
  const newcomer = box.some(one => one.at === now && !one.key.startsWith('legend:'))
  const dexReady = (species: number) => !escaped.has(species) || newcomer
  if (seen.size >= MEWTWO_DEX && dexReady(LEGENDS.mewtwo)) {
    meet(LEGENDS.mewtwo)
  }
  if (Array.from({ length: LEGENDS.mew - 1 }, (_, i) => i + 1).every(species => seen.has(species)) && dexReady(LEGENDS.mew)) {
    meet(LEGENDS.mew)
  }

  // 차례를 기다리던 전설은 앞의 전설이 끝나고 그 장면도 끝난 뒤 나타난다
  if (!encounter && waiting.length > 0 && (!scene || now - scene.at >= SCENE_GAP_MS)) {
    meet(waiting.shift()!)
  }
  // 차례를 기다리는 동안 잡은 전설은 빼 둔다
  for (const species of [...waiting]) {
    if (legends.has(species)) {
      waiting.splice(waiting.indexOf(species), 1)
    }
  }

  const next: Pokedex = {
    ...dex,
    box,
    xp,
    xpAt: now,
    lead,
    chosen,
    seen: [...seen],
    legends: [...legends],
    evolving,
    encounter,
    scene,
    fled,
    escaped: [...escaped],
    waiting,
  }
  return { dex: next, evolved, legends: arrived, fled: gone }
}

const BAR = 5

// PC BOX 머리줄의 경험치 막대
export function xpBar(xp: number): string {
  const filled = Math.max(0, Math.min(BAR, Math.floor((xp / XP_PER_EVOLUTION_MS) * BAR)))
  return '▓'.repeat(filled) + '░'.repeat(BAR - filled)
}

// 진화까지 남은 일한 시간. 분은 올림한다
export function xpLeft(xp: number): string {
  const minutes = Math.max(0, Math.ceil((XP_PER_EVOLUTION_MS - xp) / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`
}
