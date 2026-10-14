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

// pick 은 사용자가 앞장세우기를 누른 박스 칸의 key
// evolved 는 이번에 진화한 칸과 진화 전 종, legends 는 이번에 박스에 들어온 전설
export function advanceEvolution(dex: Pokedex, sessions: readonly SessionStatus[], now: number, pick: string | null = null) {
  let box = [...dex.box]
  const seen = new Set([...dex.seen, ...box.map(one => one.species)])
  const legends = new Set([...dex.legends, ...box.map(one => one.species).filter(species => LEGEND_SPECIES.includes(species))])
  const evolved: Array<{ entry: BoxEntry; from: number }> = []
  const arrived: BoxEntry[] = []

  let xp = dex.xp
  if (dex.xpAt > 0 && now - dex.xpAt <= XP_GAP_MS) {
    const working = sessions.filter(session => hasEgg(session) && livenessOf(session, now) === 'working').length
    xp += (now - dex.xpAt) * working
  }

  const able = (key: string | null) => box.find(one => one.key === key && canEvolve(one.species))
  let lead = dex.lead
  let chosen = dex.chosen
  if (pick !== null && able(pick)) {
    lead = pick
    chosen = true
  } else if (!able(lead)) {
    lead = null
    chosen = false
  }
  lead ??= autoLead(box)

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
    if (!canEvolve(species)) {
      lead = null
      chosen = false
    }
  }

  // 전설은 처음 조건을 채울 때 한 번만 온다. 저장소와 라벨은 진화한 칸, 없으면 박스 맨 앞 칸의 것을 쓴다
  const welcome = (species: number) => {
    const from = evolved[0]?.entry ?? box[0]
    if (legends.has(species) || !from) {
      return
    }
    const entry = { key: `legend:${species}`, species, root: from.root, branch: from.branch, label: from.label, at: now }
    box = [entry, ...box]
    legends.add(species)
    seen.add(species)
    arrived.push(entry)
  }
  for (const [legend, finals] of Object.entries(LEGEND_FINALS)) {
    if (evolved.some(one => finals.includes(one.entry.species))) {
      welcome(Number(legend))
    }
  }
  if (seen.size >= MEWTWO_DEX) {
    welcome(LEGENDS.mewtwo)
  }
  if (Array.from({ length: LEGENDS.mew - 1 }, (_, i) => i + 1).every(species => seen.has(species))) {
    welcome(LEGENDS.mew)
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
  }
  return { dex: next, evolved, legends: arrived }
}
