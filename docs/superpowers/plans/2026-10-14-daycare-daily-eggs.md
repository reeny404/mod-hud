# 키우미집 하루 알 7개 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키우미집을 "오늘 깰 수 있는 알 7개"로 바꾸고, 진행 중인 세션이 거기서 알을 자동으로 받게 한다.

**Architecture:** 기록(`Pokedex`)에 `day` 와 `holds`(세션 id → 든 알)를 두고, 세션이 든 알은 `holds` 로만 찾는다. 규칙은 모두 순수 함수 `advancePokedex` 한 곳에 모으고, 그림(`eggsOf`, `drawNest`)은 알 없는 세션을 빈 둥지로 그린다. `register.tsx` 는 알림 문구만 바꾼다.

**Tech Stack:** TypeScript, Claude Code mod 런타임, `claude-code/testing` (`claude plugin test .`)

**Spec:** `docs/superpowers/specs/2026-10-14-daycare-daily-eggs-design.md`

## Global Constraints

- 하루 알 수 `DAILY_EGGS = 7`. 로컬 자정에 키우미집을 새 알 7개로 바꾸고, 남은 알은 넘기지 않는다.
- 알은 세션 상태가 `working` 일 때만 받는다. 버튼은 없다.
- 알을 받기 전에 끝난 머지는 그 알을 깨지 않는다.
- 기록은 `keeperOf` 가 고른 세션 하나만 쓴다(지금 규칙 그대로).
- 주석, 테스트 이름, 알림은 지금처럼 한국어 평서문으로 쓴다.
- 테스트 실행: `claude plugin test .` (저장소 루트에서). 지금 82개 통과.

## Review Focus

1. 기존 기록 파일(옛 `sent` 가 `{count, branch}` 객체, `claims` 있음, `day` 없음)을 읽어도 깨지지 않고 바로 7개로 채운다 → Task 1 테스트 `옛 기록을 읽으면 오늘 알 7개로 채우고 갇힌 알은 버린다`.
2. 자정을 넘을 때 세션이 든 알과 머지 대기 알은 남는다 → Task 1 테스트 `자정이 지나면 키우미집만 새 알 7개로 바꾼다`.
3. 알보다 진행 중인 빈 세션이 많으면 먼저 일한 세션부터 받고, 같은 알이 두 세션에 가지 않는다 → Task 1 테스트 `알이 모자라면 먼저 일을 시작한 세션부터 받는다`.
4. 같은 맞추기에서 닫힌 세션이 돌려준 알을 진행 중인 빈 세션이 바로 받는다 → Task 1 테스트 `닫힌 세션이 돌려준 알을 진행 중인 빈 세션이 바로 받는다`.
5. 잠자기에서 돌아온 세션의 알을 이미 다른 세션이 받아 갔으면 되찾지 않는다 → Task 1 테스트 `잠자기에서 돌아온 세션은 남아 있는 자기 알만 되찾는다`.

## 커밋에 대해

`hooks/nest-lib.ts`, `hooks/nest-lib.test.ts` 는 아직 git 에 올라가지 않았고 다른 파일에도 커밋하지 않은 변경이 있다. 각 Task 의 커밋 단계는 사용자가 기존 변경을 먼저 커밋했을 때만 한다. 그렇지 않으면 커밋 단계는 건너뛰고 테스트 통과만 확인한다.

---

### Task 1: 기록 구조와 `advancePokedex` 새 규칙

**Files:**
- Modify: `types/index.d.ts:140-161` (`DexEgg` 옆에 `HeldEgg`, `Pokedex` 필드)
- Modify: `hooks/nest-lib.ts:150-378` (`emptyPokedex`, `parsePokedex`, `eggKeyOf` 삭제, `mrStateOf`, `speciesFor` 삭제, `advancePokedex`)
- Test: `hooks/nest-lib.test.ts`

**Interfaces:**
- Produces:
  - `types`: `export type HeldEgg = { key: string; species: number }`
  - `types`: `Pokedex = { day: string; hatched: Record<string, number>; pending: Array<DexEgg & { mrState: string }>; daycare: HeldEgg[]; box: BoxEntry[]; holds: Record<string, HeldEgg>; done: string[]; sent: Record<string, string | null> }`
    - `day`: 마지막으로 채운 로컬 날짜 `YYYY-MM-DD`. 빈 문자열이면 아직 안 채움
    - `hatched`: 알 key → 처음 머지를 본 시각
    - `holds`: 세션 id → 그 세션이 든 알. 세션이 닫혀도 지우지 않고 잠자기에서 돌아올 때 되찾는 데 쓴다. `known` 세션으로 거른다
    - `sent`: 세션 id → 머지돼도 깨지 않을 브랜치(박스로 보낸 브랜치, 또는 알을 받을 때 이미 머지된 브랜치)
    - `claims` 필드는 없앤다
  - `nest-lib`: `export const DAILY_EGGS = 7`
  - `nest-lib`: `export function localDay(now: number): string` — 로컬 시간대 `YYYY-MM-DD`
  - `nest-lib`: `export function freshEggs(day: string): HeldEgg[]` — key `day:${day}:${n}` (n 은 1..7), 종 `speciesOf(key)`
  - `nest-lib`: `advancePokedex(dex, sessions, now, requests?)` 반환 `{ dex: Pokedex; born: DexEgg[]; boxed: DexEgg[]; left: DexEgg[]; given: DexEgg[] }`. `claimed` 는 `given`(키우미집에서 알을 받은 세션의 알)으로 바뀐다
  - `nest-lib` 내부: `mrStateOf(sent, session)` 는 `sent[session.id] !== undefined && sent[session.id] === session.branch` 이면 `null`, 아니면 `session.mrState ?? null`

- [ ] **Step 1: 지금 `advancePokedex` 테스트 중 옛 규칙 테스트를 지우거나 고친다**

지우는 테스트(옛 규칙): `같은 저장소와 브랜치로 세션을 다시 열면 키우미집의 알을 데려온다`, `main 처럼 오래 가는 브랜치의 세션은 키우미집 알을 데려가지 않는다`.
나머지 `advancePokedex` 테스트는 "세션이 알을 들고 있다"는 전제를 기록에 넣도록 고친다. 테스트 파일 위쪽에 도우미를 둔다.

```ts
const held = (key: string, species = 25): HeldEgg => ({ key, species })
// 오늘 이미 채운 기록. 자정 채우기가 끼어들지 않게 day 를 NOW 의 날짜로 둔다
const dexOf = (patch: Partial<Pokedex> = {}): Pokedex => ({ ...emptyPokedex(), day: localDay(NOW), daycare: [], ...patch })
```

고칠 때 바뀌는 기대값:
- 알 key 는 세션 id 가 아니라 `holds` 의 key 다. 예: `dexOf({ holds: { a: held('egg-a') } })` 이면 부화한 알 key 는 `egg-a`.
- MR 없이 닫힌 세션의 알은 `daycare` 에 `{ key, species }` 로 들어간다.
- `부화한 알을 박스로 보내면…` 테스트는 `박스로 보낸 세션은 빈 세션이 되고, 진행 중이 되면 새 알을 받지만 같은 브랜치의 머지로는 깨지지 않는다` 로 바꾼다: 보낸 뒤 `holds.a` 없음, `sent.a === 'feat/a'`. 이어서 `daycare: [held('next')]` 기록에 `session('a', { state: 'working', mrState: 'merged' })` 를 맞추면 `given` 의 key 는 `['next']`, `born` 은 `[]`.
- `/clear` 테스트: `holds.old` 가 `holds.new` 로 옮겨지고, 부화 시각은 알 key 로 그대로 남는다.
- `대시보드…`, `iTerm2…` 테스트의 "닫혀도 키우미집에 가지 않는다" 부분은 알을 든 세션 `a`, `c` 만 키우미집에 간다는 기대로 고친다.

- [ ] **Step 2: 새 규칙 테스트를 쓴다**

```ts
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
```

테스트 파일 import 에 `DAILY_EGGS`, `freshEggs`, `localDay` 와 타입 `HeldEgg`, `Pokedex` 를 더한다. `SessionStatus.workingSince` 는 이미 있다(`types/index.d.ts:37`).

- [ ] **Step 3: 테스트가 실패하는지 본다**

Run: `claude plugin test .`
Expected: 위 새 테스트들이 FAIL (`localDay`, `freshEggs`, `DAILY_EGGS` 가 없다는 오류 또는 기대값 불일치)

- [ ] **Step 4: 타입과 `advancePokedex` 를 고친다**

`types/index.d.ts` 의 `Pokedex` 주석도 새 뜻으로 고친다. `parsePokedex` 는 `day` 가 문자열이 아니면 `''`, `holds` 는 `record`, `sent` 는 값이 `string` 이거나 `null` 인 항목만 남긴다(옛 객체 값은 버린다). `emptyPokedex()` 는 `{ day: '', hatched: {}, pending: [], daycare: [], box: [], holds: {}, done: [], sent: {} }`.

`advancePokedex` 의 순서(이 순서가 Review Focus 4, 5 를 만족시킨다):
1. `localDay(now) !== dex.day` 이면 `daycare = freshEggs(today)`, `day = today`.
2. `/clear`, `/resume` 이어 받기: 지금 코드처럼 `heirs` 를 만들고, 이어 받을 세션에 `holds` 와 `sent` 가 없으면 끝난 세션 것을 옮긴다. 끝난 세션의 `holds` 는 지운다. 알 key 가 같으니 `hatched` 는 옮길 필요가 없다.
3. 세션마다(`hasEgg` 인 것만):
   - 열린 세션이 `done` 에 있으면(잠자기에서 돌아옴) `done` 에서 빼고, `holds[id]` 의 key 가 `daycare` 나 `pending` 에 있으면 거기서 빼서 되찾고, 없으면 `holds[id]` 를 지운다.
   - 열린 세션이 알을 들고 있고 `mrStateOf` 가 `merged` 면 부화. 박스 요청이 있으면 박스로 보내고 `holds[id]` 를 지우고 `sent[id] = session.branch`.
   - 열린 세션이 알이 없고 `livenessOf(session, now) === 'working'` 이면 받을 후보에 넣는다.
   - 닫힌 세션은 지금처럼 `done` 과 handoff 대기를 따른다. 알을 들고 있으면 MR 이 `merged`/`opened` 일 때 `pending`, 아니면 `daycare.unshift({ key, species })` 와 `left`. `holds[id]` 는 남긴다.
4. 후보를 `workingSince ?? updatedAt` 오름차순(같으면 id)으로 정렬해 `daycare` 앞에서부터 하나씩 준다. 줄 때 `session.mrState === 'merged'` 면 `sent[id] = session.branch`. `given` 에 세션 정보로 만든 `DexEgg` 를 넣는다.
5. `pending` 정리는 지금 그대로이고, 머지 없이 닫힌 알은 `daycare.unshift({ key, species })`.
6. `holds`, `sent` 는 `known` 세션만 남긴다. `DAYCARE_MAX` 자르기는 그대로 둔다.

세션 정보로 `DexEgg` 를 만드는 지금의 `eggOf` 는 `(session, egg: HeldEgg) => DexEgg` 로 바꿔 key 와 종을 알에서 가져온다.

- [ ] **Step 5: 테스트가 통과하는지 본다**

Run: `claude plugin test .`
Expected: `nest-lib.test.ts` 의 `advancePokedex`·`parsePokedex` 테스트 PASS. `eggsOf`·그림 테스트는 Task 2 전까지 실패해도 된다.

- [ ] **Step 6: 커밋 (위 "커밋에 대해" 참고)**

```bash
git add types/index.d.ts hooks/nest-lib.ts hooks/nest-lib.test.ts
git commit -m "feat: 키우미집을 하루 알 7개로 바꾸고 진행 중인 세션이 알을 받는다"
```

---

### Task 2: 빈 둥지와 키우미집 그림

**Files:**
- Modify: `types/index.d.ts:164-174` (`NestEgg.stage` 에 `'empty'`)
- Modify: `hooks/nest-lib.ts` (`NestInput`, `eggsOf`, `speciesToLoad`, `drawSlot`, `drawNest` 의 라벨 색, `nestRows`, `drawNest` 키우미집 부분, `drawDaycare` 인자 타입)
- Test: `hooks/nest-lib.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `HeldEgg`, `Pokedex.holds`, `mrStateOf`
- Produces:
  - `NestEgg.stage: 'empty' | 'egg' | 'cracked' | 'hatched'`. 빈 세션은 `{ key: session.id, species: 0, stage: 'empty', isShaking: false, hatchedAt: null }`, `label` 과 `activity` 는 다른 알과 같이 정한다
  - `NestInput = { eggs: Egg[]; daycare: HeldEgg[]; box: BoxEntry[]; boxPage: number }`

- [ ] **Step 1: 테스트를 고치고 새로 쓴다**

`eggsOf` 테스트들은 알을 든 세션을 `dexOf({ holds: … })` 로 넣는다. 예를 들어 `열린 세션마다 알이 하나 있고…` 는 `열린 세션 중 알을 든 세션은 MR 에 따라 금이 가거나 부화하고, 알 없는 세션은 빈 둥지다` 로 바꾸고 `a,b,c` 에 알을 주고 `e`(main) 에는 주지 않아 `['momochi', 'empty']` 를 기대한다.

```ts
test('알 없는 세션은 빈 둥지로 보이고, 스프라이트를 불러오지 않는다', () => {
  const eggs = eggsOf([session('a', { state: 'working' })], dexOf(), NOW)
  expect(eggs.map(egg => [egg.key, egg.stage, egg.isShaking, egg.activity])).toEqual([['a', 'empty', false, 'working']])
  expect(speciesToLoad({ eggs, daycare: [], box: [], boxPage: 0 }, 40)).toEqual([])
})

test('키우미집은 알이 0개여도 보인다', () => {
  const empty = { eggs: [], daycare: [], box: [], boxPage: 0 }
  expect(nestRows(empty, 40)).toBe(6 + 1 + 12)
})
```

`그림은 알 줄, 키우미집, 박스를…` 테스트의 마지막 줄은 `expect(nestRows({ ...input, daycare: [] }, width)).toBe(nestRows(input, width))` 로 바꾼다. `알과 키우미집이 비면 박스만 그린다` 테스트는 위 `키우미집은 알이 0개여도 보인다` 로 대신하고 지운다. `daycare: [dexEgg('d')]` 처럼 쓴 곳은 `[held('d')]` 로 바꾼다.

- [ ] **Step 2: 테스트가 실패하는지 본다**

Run: `claude plugin test .`
Expected: 위 두 테스트 FAIL

- [ ] **Step 3: 그림을 고친다**

- `eggsOf`: 열린 세션 중 `holds[id]` 가 없으면 빈 둥지. `stage` 는 알이 있을 때만 `mrStateOf` 로 정한다.
- `drawSlot`: `stage === 'empty'` 면 둥지 바닥만 그리고 끝낸다.
- 라벨 색: `color` 표에 `empty: C.labelEgg`.
- `speciesToLoad`: `stage === 'egg' || stage === 'empty'` 는 뺀다.
- `nestRows`, `drawNest`: 키우미집 부분을 `input.daycare.length > 0` 조건 없이 늘 그린다. 0 개면 머리글 수가 `0` 이고 땅만 그린다. `DAYCARE_ROWS` 위 주석을 "알이 없어도 그린다"로 고친다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `claude plugin test .`
Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋 (위 "커밋에 대해" 참고)**

```bash
git add types/index.d.ts hooks/nest-lib.ts hooks/nest-lib.test.ts
git commit -m "feat: 알 없는 세션은 빈 둥지로, 키우미집은 늘 보인다"
```

---

### Task 3: 알림 문구와 README

**Files:**
- Modify: `hooks/register.tsx:646-668` (`advanced.claimed` → `advanced.given`)
- Modify: `hooks/register.tsx:569` 주석 ("부화, 키우미집, 박스 기록")은 그대로 두고, `pokedex` 를 쓰는 다른 곳에 `claims` 를 읽는 코드가 있으면 지운다(`grep -n "claims\|claimed\|eggKeyOf" hooks/register.tsx`)
- Modify: `README.ko.md:19`, `README.md` 의 같은 줄(포켓몬 알 설명)

**Interfaces:**
- Consumes: Task 1 의 `advancePokedex` 반환 `given`

- [ ] **Step 1: 알림을 고친다**

`advanced.claimed` 반복을 `advanced.given` 으로 바꾸고 문구는 `` `키우미집에서 ${egg.label} 알을 받았다` ``. `left` 문구 `` `키우미집에 ${egg.label} 알을 맡겼다` `` 는 그대로 둔다. 자정 채우기에는 알림을 띄우지 않는다.

- [ ] **Step 2: README 를 고친다**

`README.ko.md:19` 의 "MR 이 없는 알은 키우미집(DAY CARE)에 맡긴다. 맡긴 알은 같은 브랜치로 세션을 다시 열면 돌아온다." 를 다음 뜻으로 바꾼다: 키우미집(DAY CARE)에는 매일 로컬 자정에 알 7개가 채워지고(남은 알은 넘어가지 않는다), 일을 시작한 세션이 거기서 알을 하나 받는다. 키우미집이 비어 있으면 세션은 빈 둥지로 남고, 알이 돌아오면 일하고 있는 빈 세션이 받는다. MR 없이 닫힌 세션의 알은 키우미집으로 돌아간다. 알을 받기 전에 머지된 MR 로는 깨지지 않는다. "1세대 151마리 중 어떤 포켓몬인지는 세션이 정한다" 는 "알이 정한다" 로 고친다. `README.md` 의 영어 설명도 같은 뜻으로 고친다.

- [ ] **Step 3: 전체 확인**

Run: `claude plugin validate . && claude plugin test .`
Expected: validate 통과, 모든 테스트 PASS

- [ ] **Step 4: 커밋 (위 "커밋에 대해" 참고)**

```bash
git add hooks/register.tsx README.md README.ko.md
git commit -m "docs: 키우미집 하루 알 7개 설명과 알림 문구"
```
