// 패널 아래 빈 자리에 그리는 포켓몬 알, 키우미집, PC 박스
// 키우미집에는 매일 알 7개가 들어오고, 알 없는 세션은 진행 중이 되면 하나를 받는다
// 세션이 일하면 알이 흔들리고, 그 브랜치의 MR 이 열리면 금이 가고, 머지되면 포켓몬이 나온다
// 세션이 닫히면 부화한 포켓몬은 박스로, MR 없이 닫힌 알은 키우미집으로 돌아간다. 금 간 알은 머지될 때까지 남아 기다린다
// 기록은 모든 저장소와 세션이 같이 쓰는 파일에 남는다
// 포켓몬은 1세대 도감 번호로만 정해 두고, 그림은 MR 이 열리거나 박스를 열 때 불러온 스프라이트로 그린다

import type { BoxEntry, DexEgg, HeldEgg, NestEgg, Pokedex, SessionStatus } from '../types'
import { isLongLivedBranch, parseIssue } from './issues-lib'
import type { Pixels } from './png-lib'
import { CLEAR } from './png-lib'
import { isCodeReviewSession, KEEP_MS, livenessOf } from './sessions-lib'

export type Egg = NestEgg
export type Stage = NestEgg['stage']

// boxPage 는 0부터 센 박스 페이지. 넘치면 마지막 페이지로 당긴다
export type NestInput = { eggs: Egg[]; daycare: HeldEgg[]; box: BoxEntry[]; boxPage: number }

// 불러온 스프라이트를 size 안에 들어가게 줄여 준다. 아직 없으면 undefined
export type SpriteLookup = (species: number, size: number) => Pixels | undefined

export const DEX_SIZE = 151
// 박스 아이콘 도트는 대부분 이보다 작아 줄이지 않고 그대로 그린다. 정수 배가 아니게 줄이면 도트가 뭉개져 더 줄이지 않는다
export const HATCHED_SIZE = 24
export const ICON_SIZE = 24
// 부화한 뒤 높이 뛰며 반짝이는 시간
export const CELEBRATE_MS = 90 * 1000
// /clear 나 /resume 로 끝난 세션의 알을 이어 받을 세션이 나타나길 기다리는 시간
export const HANDOFF_MS = 2 * 60 * 1000
// 박스 한 페이지의 줄 수. 넘치면 페이지를 넘겨 본다
const BOX_ROWS_MAX = 2
// 키우미집에 남겨 두는 알 수. 넘치면 오래된 알부터 내보낸다
const DAYCARE_MAX = 30
// 이미 정리한 세션 id 를 남겨 두는 수
const DONE_MAX = 500
// 알 줄 수. 넘치는 알은 보이지 않는다
const EGG_ROWS_MAX = 2

// 알 칸과 부화한 포켓몬 칸의 폭, 그림 줄 수. 알만 있는 줄은 낮게, 포켓몬이 있는 줄만 높게 그린다
const EGG_SLOT = 16
const EGG_ROWS = 8
const HATCHED_SLOT = 24
const HATCHED_ROWS = 14
const TILE = 24
const TILE_ROWS = TILE / 2

const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20

const C = {
  // 4세대 알 스프라이트의 색
  eggLine: 0x3a3428,
  eggShine: 0xffffff,
  egg: 0xfff6de,
  eggLight: 0xeee6bd,
  eggShade: 0xd5cda4,
  spot: 0x9ccd83,
  spotLight: 0xcde6b4,
  spotShade: 0x83b46a,
  crack: 0x5a4030,
  nest: 0x9a6a3a,
  nestDark: 0x7a4f2a,
  sparkle: 0xfff6a0,
  sparkleHot: 0xffffff,
  ballRed: 0xe8384f,
  ballWhite: 0xf4f4f4,
  ballLine: 0x2a2a2a,
  labelEgg: 0x9a9a9a,
  labelCracked: 0xf0b030,
  labelHatched: 0x78c850,
  // 패널 제목의 내 차례(red), 진행 중(yellow)과 맞춘 색
  labelMine: 0xe8505b,
  labelWorking: 0xf2d24b,
  daycareBar: 0xc8782a,
  daycareGround: 0x8cc860,
  daycareGroundAlt: 0x7cb850,
  boxBar: 0x3a6ea5,
  boxBarText: 0xffffff,
  boxCount: 0xffe080,
  wall: 0xd4f0dc,
  wallAlt: 0xbfe6cc,
} as const

// 4세대 알 스프라이트(28x30)를 절반으로 줄여 다시 찍은 것. 외곽선, 위쪽 하이라이트, 아래 그림자, 연두 반점
const EGG = [
  '.....kkkk.....',
  '...kkwwwwkk...',
  '..kewwwwwwek..',
  '.keewwwwwweek.',
  '.kGgeewweeeek.',
  'kGGGeeeeeeeehk',
  'kGGGGeeGGeeeek',
  'kGGGeeeGGegGek',
  'khgGeeeeeGGGhk',
  'kheeeeeeeGGGgk',
  'kseeeeeeegGGGk',
  '.kshheeeehGDk.',
  '.ksDDshhhssDk.',
  '..kDDDsssssk..',
  '....kkkkkk....',
]
const EGG_PALETTE = {
  k: C.eggLine,
  w: C.eggShine,
  e: C.egg,
  h: C.eggLight,
  s: C.eggShade,
  G: C.spot,
  g: C.spotLight,
  D: C.spotShade,
}
const EGG_WIDTH = EGG[0]!.length
const EGG_HEIGHT = EGG.length
// 금이 간 알의 금. 위에서 내려오다 아래에서 두 갈래로 갈라진다
const CRACK = [
  [5, 2],
  [6, 3],
  [7, 4],
  [7, 5],
  [6, 6],
  [8, 6],
  [5, 7],
  [9, 7],
  [6, 8],
] as const
// 키우미집에 쌓이는 작은 알
const MINI_EGG = ['..kk..', '.kwwk.', 'keeeek', 'kGGeek', 'kGeeGk', '.kssk.', '..kk..']
const MINI_SLOT = 7
// 스프라이트를 아직 못 불러왔을 때 대신 그리는 몬스터볼
const BALL = ['..rrrr..', '.rrrrrr.', 'rrrrrrrr', 'kkkwwkkk', 'wwwkkwww', 'wwwwwwww', '.wwwwww.', '..wwww..']
const BALL_PALETTE = { r: C.ballRed, w: C.ballWhite, k: C.ballLine }
// 알을 흔드는 박자. 몇 번 빠르게 흔들고 잠깐 쉰다
const WOBBLE = [0, -1, 1, -1, 1, 0, 0, 0, 0, 0, 0, 0]
// 부화한 포켓몬이 통통 튀는 높이. 막 나왔을 때는 더 높이 뛴다
const HOP = [0, 1, 2, 1, 0, 0, 0, 0]
const HOP_HIGH = [0, 2, 4, 2, 0, 0]

function hash(text: string): number {
  let n = 2166136261
  for (let i = 0; i < text.length; i++) {
    n = Math.imul(n ^ text.charCodeAt(i), 16777619)
  }
  return n >>> 0
}

// 알 key 마다 정해지는 1세대 도감 번호
export function speciesOf(key: string): number {
  return (hash(key) % DEX_SIZE) + 1
}

// 키우미집에 매일 새로 채우는 알 수
export const DAILY_EGGS = 7

// 로컬 시간대의 날짜 YYYY-MM-DD. 이 날짜가 바뀌면 키우미집을 새로 채운다
export function localDay(now: number): string {
  const date = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 그날 키우미집에 들어오는 알. 날짜와 순번으로 key 를 지어 종도 날마다 정해진다
export function freshEggs(day: string): HeldEgg[] {
  return Array.from({ length: DAILY_EGGS }, (_, i) => {
    const key = `day:${day}:${i + 1}`
    return { key, species: speciesOf(key) }
  })
}

export const emptyPokedex = (): Pokedex => ({ day: '', hatched: {}, pending: [], daycare: [], box: [], holds: {}, done: [], sent: {} })

export function parsePokedex(text: string): Pokedex {
  try {
    const parsed = JSON.parse(text) as Partial<Pokedex>
    const eggs = <T extends { species?: unknown }>(list: unknown): T[] =>
      Array.isArray(list) ? (list as T[]).filter(entry => typeof entry?.species === 'number') : []
    const record = <T>(value: unknown): Record<string, T> => (value && typeof value === 'object' ? (value as Record<string, T>) : {})
    // 옛 기록의 sent 는 { count, branch } 라 버린다
    const sent = Object.entries(record<unknown>(Array.isArray(parsed.sent) ? {} : parsed.sent)).filter(
      (entry): entry is [string, string | null] => typeof entry[1] === 'string' || entry[1] === null,
    )
    return {
      day: typeof parsed.day === 'string' ? parsed.day : '',
      hatched: record(parsed.hatched),
      pending: eggs(parsed.pending),
      daycare: eggs(parsed.daycare),
      box: eggs(parsed.box),
      holds: record(parsed.holds),
      done: Array.isArray(parsed.done) ? parsed.done : [],
      sent: Object.fromEntries(sent),
    }
  } catch {
    return emptyPokedex()
  }
}

// 알을 쥐고 있는 세션. 끊긴 지 한 시간이 안 된 세션은 잠자기에서 돌아올 수 있어 열린 것으로 본다
export function isOpenSession(session: SessionStatus, now: number): boolean {
  const liveness = livenessOf(session, now)
  return liveness === 'working' || liveness === 'waiting' || (liveness === 'stale' && now - session.updatedAt <= KEEP_MS)
}

// 알을 갖는 세션. /mod-hud dashboard 로 대시보드라고 표시한 세션과 iTerm2 리뷰 세션은 알이 없다
export function hasEgg(session: SessionStatus): boolean {
  return !session.isDashboard && !isCodeReviewSession(session)
}

// 기록을 쓰는 세션. 열린 세션 중 id 가 가장 작은 세션 하나만 써서 여러 세션이 서로 덮어쓰지 않게 한다
export function keeperOf(sessions: readonly SessionStatus[], now: number): string | null {
  const open = sessions.filter(session => isOpenSession(session, now)).map(session => session.id)
  return open.length > 0 ? open.reduce((a, b) => (a < b ? a : b)) : null
}

export function labelOf(session: Pick<SessionStatus, 'branch' | 'project'>): string {
  if (!session.branch || isLongLivedBranch(session.branch, 'main')) {
    return session.project
  }
  const issue = parseIssue(session.branch)
  return issue ? `#${issue}` : session.branch
}

type Sent = Pokedex['sent']

// mrState 를 지금 브랜치에서 조회했는지. mrBranch 가 없는 옛 상태 파일은 아직 모르는 것으로 친다
function knowsMr(session: SessionStatus): boolean {
  return session.mrBranch !== undefined && session.mrBranch === session.branch
}

// 지금 알에 쓰는 MR 상태. 박스로 보냈거나 알을 받을 때 이미 머지된 브랜치에 머무는 동안은 머지되지 않은 것으로 친다
// 다른 브랜치를 보고 적은 MR 상태는 모르는 것으로 친다. mrBranch 가 없는 옛 상태 파일은 예전처럼 믿는다
function mrStateOf(sent: Sent, session: SessionStatus): string | null {
  if (sent[session.id] !== undefined && sent[session.id] === session.branch) {
    return null
  }
  if (session.mrBranch !== undefined && session.mrBranch !== session.branch) {
    return null
  }
  return session.mrState ?? null
}

// 세션 상태와 기록을 맞춘다. 기록을 쓰는 세션이 세션 목록을 읽을 때마다 부른다
// requests 는 박스로 보내기를 누른 알의 key. 부화한 알만 보낸다
// born 은 이번에 부화한 알, boxed 는 박스에 넣은 포켓몬, left 는 키우미집에 맡긴 알, given 은 키우미집에서 받은 알
export function advancePokedex(dex: Pokedex, sessions: readonly SessionStatus[], now: number, requests: readonly string[] = []) {
  const today = localDay(now)
  const hatched = { ...dex.hatched }
  const holds = { ...dex.holds }
  let pending = [...dex.pending]
  // 날짜가 바뀌면 키우미집에 남은 알은 버리고 그날 알로 새로 채운다
  let daycare = today === dex.day ? [...dex.daycare] : freshEggs(today)
  const box = [...dex.box]
  const done = new Set(dex.done)
  const sent: Sent = { ...dex.sent }
  const asked = new Set(requests)
  const born: DexEgg[] = []
  const boxed: DexEgg[] = []
  const left: DexEgg[] = []
  const given: DexEgg[] = []
  const eggOf = (session: SessionStatus, egg: HeldEgg): DexEgg => ({
    key: egg.key,
    species: egg.species,
    root: session.root,
    branch: session.branch,
    label: labelOf(session),
    at: now,
  })
  const hatch = (egg: DexEgg) => {
    if (hatched[egg.key] === undefined) {
      hatched[egg.key] = now
      born.push(egg)
    }
  }
  const toBox = (egg: DexEgg) => {
    delete hatched[egg.key]
    box.unshift({ ...egg, at: now })
    boxed.push(egg)
  }
  // 키우미집으로 돌아간 알은 다음에 받은 세션에서 새로 부화한다
  const toDaycare = (egg: DexEgg) => {
    delete hatched[egg.key]
    daycare.unshift({ key: egg.key, species: egg.species })
    left.push(egg)
  }
  // 세션이 놓은 알. 머지됐거나 MR 이 열려 있으면 머지를 기다리고, 아니면 키우미집으로 간다
  const release = (session: SessionStatus, held: HeldEgg) => {
    const egg = eggOf(session, held)
    const mrState = mrStateOf(sent, session)
    if (mrState === 'merged' || mrState === 'opened') {
      pending.push({ ...egg, mrState })
    } else {
      toDaycare(egg)
    }
  }

  // /clear 나 /resume 는 같은 창에서 새 id 로 이어지므로, 끝난 세션의 알은 이어진 세션이 물려받는다
  const heirs = new Map(
    sessions.flatMap(session => (session.predecessor && isOpenSession(session, now) ? [[session.predecessor, session] as const] : [])),
  )
  for (const session of sessions) {
    const heir = heirs.get(session.id)
    if (!heir || isOpenSession(session, now) || done.has(session.id)) {
      continue
    }
    done.add(session.id)
    const egg = holds[session.id]
    // 이어 받을 세션이 이미 알을 들고 있으면 끝난 세션의 알은 닫힌 세션의 알처럼 놓는다
    if (egg && holds[heir.id]) {
      release(session, egg)
    } else if (egg) {
      holds[heir.id] = egg
    }
    if (sent[session.id] !== undefined && sent[heir.id] === undefined) {
      sent[heir.id] = sent[session.id]!
    }
    delete holds[session.id]
  }

  // 알이 없는 진행 중인 세션. 아래에서 키우미집의 알을 나눠 준다
  const empty: SessionStatus[] = []
  for (const session of sessions) {
    if (!hasEgg(session)) {
      // 알을 받은 뒤 대시보드로 표시한 세션은 든 알을 놓는다
      const mine = holds[session.id]
      if (mine) {
        release(session, mine)
        delete holds[session.id]
      }
      if (!isOpenSession(session, now)) {
        done.add(session.id)
      }
      continue
    }
    if (isOpenSession(session, now)) {
      // 잠자기에서 한 시간 넘게 지나 닫힌 것으로 보낸 세션이 돌아오면, 아직 아무도 안 받아 간 자기 알만 되찾는다
      if (done.has(session.id)) {
        done.delete(session.id)
        const key = holds[session.id]?.key
        if (daycare.some(egg => egg.key === key) || pending.some(egg => egg.key === key)) {
          daycare = daycare.filter(egg => egg.key !== key)
          pending = pending.filter(egg => egg.key !== key)
        } else {
          delete holds[session.id]
        }
      }
      const mine = holds[session.id]
      if (mine && mrStateOf(sent, session) === 'merged') {
        const egg = eggOf(session, mine)
        hatch(egg)
        // 박스로 보내면 빈 세션이 된다. 같은 브랜치의 머지로 다음 알이 깨지지 않게 브랜치를 기억한다
        if (asked.has(egg.key)) {
          toBox(egg)
          delete holds[session.id]
          sent[session.id] = session.branch
        }
      }
      if (!holds[session.id] && livenessOf(session, now) === 'working') {
        empty.push(session)
      }
      continue
    }
    if (done.has(session.id)) {
      continue
    }
    // 이어 받을 세션이 아직 상태를 쓰지 않았을 수 있어 잠깐 기다린다
    const isHandingOff = session.endReason === 'clear' || session.endReason === 'resume'
    if (isHandingOff && now - session.updatedAt < HANDOFF_MS) {
      continue
    }
    done.add(session.id)
    // 든 알은 holds 에 남겨 둬 잠자기에서 돌아오면 되찾게 한다
    const mine = holds[session.id]
    if (!mine) {
      continue
    }
    release(session, mine)
  }

  // 먼저 일을 시작한 세션부터 키우미집 앞의 알을 하나씩 받는다
  // 지금 브랜치의 MR 상태를 아직 모르는 세션은 이번에는 건너뛴다. 이미 머지된 브랜치에서 받은 알이 그 머지로 깨지지 않게 한다
  empty.sort((a, b) => (a.workingSince ?? a.updatedAt) - (b.workingSince ?? b.updatedAt) || (a.id < b.id ? -1 : 1))
  for (const session of empty.filter(knowsMr)) {
    const egg = daycare.shift()
    if (!egg) {
      break
    }
    // 이 알을 전에 들었던 세션은 잠자기에서 돌아와도 되찾지 못하게 기록에서 지운다
    for (const [id, other] of Object.entries(holds)) {
      if (other.key === egg.key) {
        delete holds[id]
      }
    }
    holds[session.id] = egg
    // 이미 머지된 브랜치에서 받은 알은 그 머지로 깨지지 않는다
    if (session.mrState === 'merged') {
      sent[session.id] = session.branch
    }
    given.push(eggOf(session, egg))
  }

  // 머지된 알은 부화해 잠깐 뛰다가 박스로 간다. 머지 없이 닫힌 MR 의 알은 키우미집으로 간다
  pending = pending.filter(egg => {
    if (egg.mrState === 'merged') {
      hatch(egg)
      if (now - (hatched[egg.key] ?? now) < CELEBRATE_MS && !asked.has(egg.key)) {
        return true
      }
      const { mrState: _, ...entry } = egg
      toBox(entry)
      return false
    }
    if (egg.mrState !== 'opened') {
      const { mrState: _, ...entry } = egg
      toDaycare(entry)
      return false
    }
    return true
  })

  // 상태 파일이 지워진 세션은 다시 볼 일이 없으니 정리한 기록에서도 뺀다
  const known = new Set(sessions.map(session => session.id))
  const ofKnown = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id)))
  const nextDaycare = daycare.slice(0, DAYCARE_MAX)
  const nextHolds = ofKnown(holds)
  // 들거나 맡기거나 기다리는 알이 아닌 알의 부화 기록은 지운다
  const kept = new Set([...Object.values(nextHolds), ...nextDaycare, ...pending].map(egg => egg.key))
  const next: Pokedex = {
    day: today,
    hatched: Object.fromEntries(Object.entries(hatched).filter(([key]) => kept.has(key))),
    pending,
    daycare: nextDaycare,
    box,
    holds: nextHolds,
    done: [...done].filter(id => known.has(id)).slice(-DONE_MAX),
    sent: ofKnown(sent),
  }
  return { dex: next, born, boxed, left, given }
}

// 기다리는 알의 MR 상태를 바꾼다. 기록을 쓰는 세션이 MR 을 다시 조회한 뒤 부른다
export function updatePending(dex: Pokedex, key: string, mrState: string): Pokedex {
  return { ...dex, pending: dex.pending.map(egg => (egg.key === key ? { ...egg, mrState } : egg)) }
}

// 패널에 그릴 알. 열린 세션의 알을 먼저, 머지를 기다리는 알을 그 뒤에 둔다. 자리가 바뀌지 않게 세션 id 순으로 둔다
export function eggsOf(sessions: readonly SessionStatus[], dex: Pokedex, now: number): Egg[] {
  const stageOf = (mrState: string | null | undefined): Stage =>
    mrState === 'merged' ? 'hatched' : mrState === 'opened' ? 'cracked' : 'egg'
  const open = sessions
    .filter(session => isOpenSession(session, now) && hasEgg(session))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(session => {
      // 알을 아직 안 받은 세션은 세션 id 로 된 빈 둥지로 둔다
      const mine = dex.holds[session.id]
      const key = mine?.key ?? session.id
      const stage = mine ? stageOf(mrStateOf(dex.sent, session)) : 'empty'
      const isWorking = livenessOf(session, now) === 'working'
      return {
        key,
        label: labelOf(session),
        species: mine?.species ?? 0,
        stage,
        isShaking: (stage === 'egg' || stage === 'cracked') && isWorking,
        activity: session.attention ? ('mine' as const) : isWorking ? ('working' as const) : null,
        hatchedAt: dex.hatched[key] ?? null,
      }
    })
  const waiting = dex.pending.map(egg => ({
    key: egg.key,
    label: egg.label,
    species: egg.species,
    stage: stageOf(egg.mrState),
    isShaking: false,
    activity: null,
    hatchedAt: dex.hatched[egg.key] ?? null,
  }))
  return [...open, ...waiting]
}

// 그림에 쓸 스프라이트 번호. 금 간 알은 곧 나올 것이라 미리 불러 둔다
export function speciesToLoad(input: NestInput, width: number): number[] {
  const eggs = eggsOnScreen(input, width).filter(egg => egg.stage !== 'egg' && egg.stage !== 'empty')
  const box = boxOnPage(input, width)
  return [...new Set([...eggs.map(egg => egg.species), ...box.map(entry => entry.species)])]
}

// 픽셀 그림판. 비운 픽셀은 터미널 배경이 비친다
type Canvas = { width: number; height: number; px: Uint32Array }

function canvasOf(width: number, height: number): Canvas {
  return { width, height, px: new Uint32Array(width * height).fill(CLEAR) }
}

function put(canvas: Canvas, x: number, y: number, color: number) {
  if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
    canvas.px[y * canvas.width + x] = color
  }
}

function sprite(canvas: Canvas, x: number, y: number, rows: string[], palette: Record<string, number>) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const color = palette[row[dx] ?? '.']
      if (color !== undefined) {
        put(canvas, x + dx, y + dy, color)
      }
    }
  })
}

function blit(canvas: Canvas, x: number, y: number, image: Pixels) {
  image.px.forEach((color, i) => {
    if (color !== CLEAR) {
      put(canvas, x + (i % image.width), y + Math.floor(i / image.width), color)
    }
  })
}

function drawEgg(canvas: Canvas, x: number, y: number) {
  sprite(canvas, x, y, EGG, EGG_PALETTE)
}

// 반짝이는 별을 width x height 칸 안에 흩뿌린다
function drawSparkles(canvas: Canvas, x: number, y: number, width: number, height: number, frame: number) {
  const spots = [
    [0.05, 0.25],
    [0.9, 0.1],
    [0.1, 0.7],
    [0.92, 0.55],
    [0.45, 0.02],
    [0.7, 0.35],
  ] as const
  spots.forEach(([fx, fy], i) => {
    const dx = Math.round(fx * (width - 1))
    const dy = y + Math.round(fy * (height - 1))
    if ((frame + i) % 3 === 0) {
      return
    }
    const color = (frame + i) % 2 === 0 ? C.sparkle : C.sparkleHot
    put(canvas, x + dx, dy, color)
    if ((frame + i) % 3 === 1) {
      put(canvas, x + dx - 1, dy, color)
      put(canvas, x + dx + 1, dy, color)
      put(canvas, x + dx, dy - 1, color)
      put(canvas, x + dx, dy + 1, color)
    }
  })
}

function drawSlot(canvas: Canvas, slotX: number, slot: number, egg: Egg, frame: number, now: number, lookup: SpriteLookup) {
  const floor = canvas.height - 1
  const eggX = slotX + Math.floor((slot - EGG_WIDTH) / 2)
  const eggTop = floor - EGG_HEIGHT
  for (let dx = 1; dx < slot - 1; dx++) {
    put(canvas, slotX + dx, floor, dx % 2 === 0 ? C.nest : C.nestDark)
  }
  if (egg.stage === 'empty') {
    return
  }
  if (egg.stage === 'hatched') {
    // 껍질 없이 포켓몬만 둥지 위에서 통통 튄다. 막 나왔을 때는 더 높이 뛰며 반짝인다
    const isCelebrating = egg.hatchedAt !== null && now - egg.hatchedAt < CELEBRATE_MS
    const hops = isCelebrating ? HOP_HIGH : HOP
    const bottom = floor - 1 - (hops[(frame + egg.key.length) % hops.length] ?? 0)
    const image = lookup(egg.species, HATCHED_SIZE)
    if (image) {
      blit(canvas, slotX + Math.floor((slot - image.width) / 2), bottom - image.height + 1, image)
    } else {
      sprite(canvas, slotX + Math.floor((slot - 8) / 2), bottom - 7, BALL, BALL_PALETTE)
    }
    if (isCelebrating) {
      drawSparkles(canvas, slotX, 0, slot, floor, frame)
    }
    return
  }
  const shift = egg.isShaking ? (WOBBLE[(frame + egg.key.length) % WOBBLE.length] ?? 0) : 0
  drawEgg(canvas, eggX + shift, eggTop)
  if (egg.stage === 'cracked') {
    for (const [dx, dy] of CRACK) {
      put(canvas, eggX + shift + dx, eggTop + dy, C.crack)
    }
  }
}

// 박스는 많이 훑어보는 곳이라 아이콘을 움직이지 않는다
function drawBox(canvas: Canvas, box: BoxEntry[], perRow: number, lookup: SpriteLookup) {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      put(canvas, x, y, ((x >> 2) + (y >> 2)) % 2 === 0 ? C.wall : C.wallAlt)
    }
  }
  const margin = Math.floor((canvas.width - perRow * TILE) / 2)
  box.forEach((entry, i) => {
    const tileX = margin + (i % perRow) * TILE
    const bottom = Math.floor(i / perRow) * TILE + TILE - 2
    const image = lookup(entry.species, ICON_SIZE)
    if (image) {
      blit(canvas, tileX + Math.floor((TILE - image.width) / 2), bottom - image.height + 1, image)
    } else {
      sprite(canvas, tileX + Math.floor((TILE - 8) / 2), bottom - 7, BALL, BALL_PALETTE)
    }
  })
}

// 위아래 두 픽셀을 반 블록 한 칸에 담는다. 둘 다 비면 빈칸으로 둔다
function pixelCells(canvas: Canvas, out: number[]) {
  for (let row = 0; row < canvas.height / 2; row++) {
    for (let x = 0; x < canvas.width; x++) {
      const top = canvas.px[row * 2 * canvas.width + x] ?? CLEAR
      const bottom = canvas.px[(row * 2 + 1) * canvas.width + x] ?? CLEAR
      if (top === CLEAR && bottom === CLEAR) {
        out.push(SPACE, CLEAR, CLEAR)
      } else if (top === CLEAR) {
        out.push(LOWER_HALF, bottom, CLEAR)
      } else {
        out.push(UPPER_HALF, top, bottom)
      }
    }
  }
}

// 글자 한 줄. Raster 는 한 칸짜리 글자만 받으므로 ASCII 밖의 글자는 ? 로 바꾼다
function textCells(width: number, parts: { at: number; text: string; color: number }[], background: number, out: number[]) {
  const line = Array.from({ length: width }, () => [SPACE, CLEAR, background])
  for (const part of parts) {
    for (let i = 0; i < part.text.length; i++) {
      const at = part.at + i
      const code = part.text.charCodeAt(i)
      if (at >= 0 && at < width) {
        line[at] = [code >= 0x20 && code < 0x7f ? code : 0x3f, part.color, background]
      }
    }
  }
  for (const cell of line) {
    out.push(...cell)
  }
}

type EggRow = { eggs: Egg[]; slots: number[]; rows: number }

// 알을 줄마다 채운다. 알은 좁은 칸, 부화한 포켓몬은 넓은 칸을 쓴다. 두 줄을 넘는 알은 보이지 않는다
function eggLayout(eggs: Egg[], width: number): EggRow[] {
  const rows: EggRow[] = []
  let current: Egg[] = []
  let used = 0
  const close = () => {
    const slots = current.map(egg => (egg.stage === 'hatched' ? HATCHED_SLOT : EGG_SLOT))
    rows.push({ eggs: current, slots, rows: current.some(egg => egg.stage === 'hatched') ? HATCHED_ROWS : EGG_ROWS })
    current = []
    used = 0
  }
  for (const egg of eggs) {
    const slot = egg.stage === 'hatched' ? HATCHED_SLOT : EGG_SLOT
    if (current.length > 0 && used + slot > width) {
      close()
      if (rows.length === EGG_ROWS_MAX) {
        return rows
      }
    }
    current.push(egg)
    used += slot
  }
  if (current.length > 0 && rows.length < EGG_ROWS_MAX) {
    close()
  }
  return rows
}

// 패널에 보이는 알. 박스로 보내기 버튼과 스프라이트를 불러올 대상이 이것이다
export function eggsOnScreen(input: NestInput, width: number): Egg[] {
  return eggLayout(input.eggs, width).flatMap(row => row.eggs)
}

function boxPerRow(width: number): number {
  return Math.max(1, Math.floor(width / TILE))
}

export function boxPages(input: NestInput, width: number): number {
  return Math.max(1, Math.ceil(input.box.length / (BOX_ROWS_MAX * boxPerRow(width))))
}

// 페이지가 여럿이면 마지막 페이지가 덜 차도 높이가 바뀌지 않게 늘 꽉 찬 줄 수로 그린다
function boxRows(input: NestInput, width: number): number {
  if (boxPages(input, width) > 1) {
    return BOX_ROWS_MAX
  }
  return Math.max(1, Math.ceil(input.box.length / boxPerRow(width)))
}

export function boxPageOf(input: NestInput, width: number): number {
  return Math.min(Math.max(0, input.boxPage), boxPages(input, width) - 1)
}

function boxOnPage(input: NestInput, width: number): BoxEntry[] {
  const size = BOX_ROWS_MAX * boxPerRow(width)
  const page = boxPageOf(input, width)
  return input.box.slice(page * size, (page + 1) * size)
}

// 키우미집은 머리글 한 줄과 작은 알 한 줄. 알이 없어도 그린다
const DAYCARE_ROWS = 1 + 4

function drawDaycare(canvas: Canvas, eggs: HeldEgg[], frame: number) {
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      put(canvas, x, y, (x + (y >> 1)) % 4 === 0 ? C.daycareGroundAlt : C.daycareGround)
    }
  }
  const shown = Math.floor((canvas.width - 2) / MINI_SLOT)
  eggs.slice(0, shown).forEach((egg, i) => {
    // 차곡차곡 쌓인 알이 가끔 하나씩 꼼지락거린다
    const nudge = (frame + i * 5) % 24 === 0 ? -1 : 0
    const x = 1 + i * MINI_SLOT
    sprite(canvas, x, 1 + nudge, MINI_EGG, EGG_PALETTE)
  })
}

// 알 줄, 키우미집, 박스를 그린다. 세션이 없으면 알 줄은 빼고, 키우미집은 알이 없어도 그리고, 박스는 비어도 한 줄을 보인다
export function nestRows(input: NestInput, width: number): number {
  // 알 한 줄은 그림과 라벨 한 줄이고, 알이 있으면 그 아래 한 줄을 띄운다
  const layout = eggLayout(input.eggs, width)
  const eggs = layout.reduce((sum, row) => sum + row.rows + 1, 0) + (layout.length > 0 ? 1 : 0)
  const daycare = DAYCARE_ROWS + 1
  return eggs + daycare + 1 + boxRows(input, width) * TILE_ROWS
}

export function drawNest(input: NestInput, width: number, frame: number, now: number, lookup: SpriteLookup): Uint32Array {
  const out: number[] = []
  const color = { empty: C.labelEgg, egg: C.labelEgg, cracked: C.labelCracked, hatched: C.labelHatched }
  for (const row of eggLayout(input.eggs, width)) {
    const canvas = canvasOf(width, row.rows * 2)
    const total = row.slots.reduce((sum, slot) => sum + slot, 0)
    const starts = row.slots.map((_, i) => Math.floor((width - total) / 2) + row.slots.slice(0, i).reduce((sum, slot) => sum + slot, 0))
    row.eggs.forEach((egg, i) => drawSlot(canvas, starts[i]!, row.slots[i]!, egg, frame, now, lookup))
    pixelCells(canvas, out)
    textCells(
      width,
      row.eggs.map((egg, i) => {
        const slot = row.slots[i]!
        const text = egg.label.length > slot - 1 ? egg.label.slice(0, slot - 1) : egg.label
        const tint = egg.activity === 'mine' ? C.labelMine : egg.activity === 'working' ? C.labelWorking : color[egg.stage]
        return { at: starts[i]! + Math.floor((slot - text.length) / 2), text, color: tint }
      }),
      CLEAR,
      out,
    )
  }
  if (input.eggs.length > 0) {
    textCells(width, [], CLEAR, out)
  }

  const daycareCount = `${input.daycare.length}`
  textCells(
    width,
    [
      { at: 1, text: 'DAY CARE', color: C.boxBarText },
      { at: width - daycareCount.length - 1, text: daycareCount, color: C.boxCount },
    ],
    C.daycareBar,
    out,
  )
  const ground = canvasOf(width, (DAYCARE_ROWS - 1) * 2)
  drawDaycare(ground, input.daycare, frame)
  pixelCells(ground, out)
  textCells(width, [], CLEAR, out)

  const count = `${input.box.length}`
  const pages = boxPages(input, width)
  const title = pages > 1 ? `PC BOX  ${boxPageOf(input, width) + 1}/${pages}` : 'PC BOX'
  textCells(
    width,
    [
      { at: 1, text: title, color: C.boxBarText },
      { at: width - count.length - 1, text: count, color: C.boxCount },
    ],
    C.boxBar,
    out,
  )
  const box = canvasOf(width, boxRows(input, width) * TILE)
  drawBox(box, boxOnPage(input, width), boxPerRow(width), lookup)
  pixelCells(box, out)
  return Uint32Array.from(out)
}
