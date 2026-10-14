# 진화, 알에서 나오는 포켓몬 제한, 알 모양 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 알에서는 1세대 진화 전 모습 74종만 나오게 하고, 세션이 일한 시간으로 박스의 앞장선 포켓몬을 진화시키고, 알 모양과 흔들림과 PC BOX 를 다듬는다.

**Architecture:** 도감 데이터(진화 전 모습, 진화표, 전설 조건)는 새 파일 `hooks/dex-data.ts` 에 박아 둔다. 경험치, 앞장, 진화, 전설 규칙은 새 순수 함수 `advanceEvolution`(새 파일 `hooks/evolve-lib.ts`)에 모으고, 기록을 쓰는 세션이 `advancePokedex` 바로 뒤에 부른다. 알 그림은 `nest-lib.ts` 에서 바꾸고, PC BOX 는 큰 Raster 한 장에서 빼내 칸마다 작은 Raster 로 그려 hover 카드를 건다.

**Tech Stack:** TypeScript, Claude Code mod 런타임(Ink 요소, `Raster`, `Box hover`), `claude-code/testing` (`claude plugin test .`)

**Spec:** `docs/superpowers/specs/2026-10-14-evolution-and-egg-look-design.md`

## Global Constraints

- 알에서 나오는 종은 spec 의 74종 목록뿐이다. 전설 144, 145, 146, 150, 151 은 알에서 나오지 않는다.
- 진화는 spec 의 진화표(1세대 안)만 따른다. 이브이(133)는 134/135/136 중 하나.
- 진화 한 번에 일한 시간 `XP_PER_EVOLUTION_MS = 3 * 60 * 60 * 1000`. 진화하면 경험치는 0 부터. 지난번 맞춘 뒤 `XP_GAP_MS = 5 * 60 * 1000` 넘게 지났으면 그 사이는 세지 않는다.
- 경험치는 `hasEgg` 인 세션 중 `livenessOf(...) === 'working'` 인 세션 수 × 흐른 시간. 기록을 쓰는 세션(`keeperOf`)만 더한다.
- 경험치 막대는 하나. 앞장이 바뀌어도 경험치는 남는다.
- 이미 있는 알(키우미집, holds, pending)과 박스 포켓몬의 종은 바꾸지 않는다.
- 흔들림 각도(250ms 프레임): `0, -15, -25, -15, 0, 15, 25, 15, 0, -10, 0, 10, 0, 0, 0, 0, 0, 0`.
- PC BOX 아이콘 `fit(image, 18)`, 한 페이지 한 줄.
- 키우미집 그림은 바꾸지 않는다.
- 주석, 테스트 이름, 토스트는 지금처럼 한국어 평서문으로 쓴다. 기록 파일은 `~/.claude/mod-hud-pokedex.json` 하나.
- 테스트 실행: `claude plugin test .` (저장소 루트). 지금 104개 통과.

## Review Focus

1. 예전 기록 파일(새 필드 없음, 박스에 예전 규칙의 진화형과 전설 있음)을 읽어도 깨지지 않고, 도감은 박스로 채우고, 박스에 이미 있는 전설은 다시 주지 않는다 → Task 2 테스트 `예전 기록을 읽으면 도감은 박스로 채우고 박스에 있는 전설은 받은 것으로 친다`.
2. 잠자기 뒤 처음 맞출 때 빈 시간이 경험치로 들어가지 않는다 → Task 2 테스트 `5분 넘게 끊긴 시간은 경험치로 세지 않는다`.
3. 경험치가 아무리 쌓여도 한 번 맞출 때 한 마리만, 한 단계만 진화한다 → Task 2 테스트 `경험치가 많이 쌓여도 한 번에 한 단계만 진화하고 0 부터 다시 센다`.
4. 앞장선 포켓몬이 박스에서 사라지거나(기록이 바뀜) 진화할 수 없는 포켓몬을 고르는 요청이 와도 깨지지 않는다 → Task 2 테스트 `없는 포켓몬이나 진화할 수 없는 포켓몬을 앞장세우는 요청은 무시한다`.
5. 대시보드 세션이나 나를 기다리는 세션은 경험치를 쌓지 않는다 → Task 2 테스트 `일하는 세션만, 대시보드를 빼고 경험치를 쌓는다`.

---

### Task 1: 도감 데이터와 알에서 나오는 종 제한

**Files:**
- Create: `hooks/dex-data.ts`
- Modify: `hooks/nest-lib.ts` (`speciesOf`, `DEX_SIZE` 주석)
- Test: `hooks/dex-data.test.ts`, `hooks/nest-lib.test.ts` (`같은 세션은 늘 같은 포켓몬이고...` 테스트를 고친다)

**Interfaces:**
- Produces (`hooks/dex-data.ts`):
  - `export const EGG_SPECIES: readonly number[]` — spec 의 74종, 번호 순.
  - `export const EVOLUTIONS: Readonly<Record<number, readonly number[]>>` — spec 진화표. `133: [134, 135, 136]`.
  - `export const LEGENDS = { articuno: 144, zapdos: 145, moltres: 146, mewtwo: 150, mew: 151 } as const`
  - `export const LEGEND_FINALS: Readonly<Record<144 | 145 | 146, readonly number[]>>` — `144: [87, 91]`, `145: [26, 82, 101, 135]`, `146: [6, 38, 59, 78, 136]`.
  - `export const MEWTWO_DEX = 100`
  - `export function canEvolve(species: number): boolean`
- Produces (`hooks/nest-lib.ts`): `speciesOf(key: string): number` 가 `EGG_SPECIES[hash(key) % EGG_SPECIES.length]` 를 돌려준다. `hash` 는 그대로 쓰고 `export` 해서 Task 2 가 쓴다: `export function hash(text: string): number`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`hooks/dex-data.test.ts`)

```ts
test('알에서 나오는 종은 74종이고 전설과 진화형은 없다', () => {
  expect(EGG_SPECIES.length).toBe(74)
  for (const legend of [144, 145, 146, 150, 151]) expect(EGG_SPECIES).not.toContain(legend)
  const evolved = new Set(Object.values(EVOLUTIONS).flat())
  for (const species of EGG_SPECIES) expect(evolved.has(species)).toBe(false)
  expect(EGG_SPECIES).toContain(25) // 피츄는 2세대라 피카츄가 진화 전 모습
  expect(EGG_SPECIES).toContain(143)
})
test('진화표는 1세대 안에서만 진화하고 이브이만 갈라진다', () => {
  expect(EVOLUTIONS[133]).toEqual([134, 135, 136])
  expect(Object.values(EVOLUTIONS).flat().every(n => n <= 151)).toBe(true)
  expect(Object.entries(EVOLUTIONS).filter(([, to]) => to.length > 1).map(([from]) => from)).toEqual(['133'])
  expect(canEvolve(42)).toBe(false) // 골뱃은 크로뱃이 되지 않는다
  expect(canEvolve(4)).toBe(true)
  expect(canEvolve(6)).toBe(false)
})
```

  `nest-lib.test.ts` 의 `같은 세션은 늘 같은 포켓몬이고, 세션이 다르면 1세대 151마리에 고르게 퍼진다` 를 `... 알에서 나오는 74종에 고르게 퍼진다` 로 바꾸고, 2000개 key 의 종이 모두 `EGG_SPECIES` 안이며 60종 넘게 나오는지 본다.

- [ ] **Step 2: 실패하는지 본다** — Run: `claude plugin test .` Expected: `dex-data` 를 찾지 못해 FAIL.
- [ ] **Step 3: `hooks/dex-data.ts` 를 쓰고 `speciesOf` 를 바꾼다.** 값은 spec 의 목록과 진화표를 그대로 옮긴다.
- [ ] **Step 4: 통과하는지 본다** — Run: `claude plugin test .` Expected: 모두 PASS.
- [ ] **Step 5: 커밋** — `git commit -m "feat: 알에서는 1세대 진화 전 모습 74종만 나온다"`

---

### Task 2: 경험치, 앞장, 진화, 전설 규칙

**Files:**
- Create: `hooks/evolve-lib.ts`, `hooks/evolve-lib.test.ts`
- Modify: `types/index.d.ts` (`Pokedex`), `hooks/nest-lib.ts` (`emptyPokedex`, `parsePokedex`)

**Interfaces:**
- Consumes: Task 1 의 `EVOLUTIONS`, `LEGENDS`, `LEGEND_FINALS`, `MEWTWO_DEX`, `canEvolve`, `hash`. `nest-lib` 의 `hasEgg`, `livenessOf`(sessions-lib).
- Produces (`types/index.d.ts`, `Pokedex` 에 더한다):

```ts
  // 앞장선 포켓몬이 먹은 경험치(일한 시간 ms). 막대는 하나라 앞장이 바뀌어도 남는다
  xp: number
  // 경험치를 마지막으로 더한 시각. 0 이면 아직 안 더했다
  xpAt: number
  // 앞장선 박스 포켓몬의 key. chosen 이면 사용자가 고른 것
  lead: string | null
  chosen: boolean
  // 지금까지 박스에 들어온 종. 진화해서 사라진 종도 남는다
  seen: number[]
  // 이미 받은 전설
  legends: number[]
  // 가장 최근 진화. 모든 세션의 패널이 깜빡임을 그리는 데 쓴다
  evolving: { key: string; from: number; at: number } | null
```

- Produces (`hooks/evolve-lib.ts`):
  - `export const XP_PER_EVOLUTION_MS`, `export const XP_GAP_MS` (Global Constraints 값)
  - `export function evolutionOf(entry: BoxEntry): number | null` — 진화표의 다음 종. 갈라지면 `hash(\`evolve:${entry.key}\`) % n` 으로 고른다.
  - `export function autoLead(box: readonly BoxEntry[]): string | null` — spec 의 자동 규칙(같은 종 3마리 이상이면 그 종 중 `at` 가 가장 작은 것, 아니면 진화할 수 있는 것 중 `at` 가 가장 작은 것).
  - `export function advanceEvolution(dex: Pokedex, sessions: readonly SessionStatus[], now: number, pick: string | null = null): { dex: Pokedex; evolved: Array<{ entry: BoxEntry; from: number }>; legends: BoxEntry[] }`
  - `export function withJosa(word: string, pair: '이/가' | '으로/로'): string` — 받침으로 조사를 붙인다(`꼬렛이`, `레트라로`, `리자몽으로`). 받침 ㄹ 이면 `로`. 한글이 아니면 뒤 것을 붙인다.

`advanceEvolution` 순서(한 번 부를 때):
1. `seen` 에 박스의 종을 합친다. 박스에 이미 있는 전설은 `legends` 에 넣는다.
2. 경험치: `xpAt > 0 && now - xpAt <= XP_GAP_MS` 일 때만 `(now - xpAt) × 일하는 세션 수` 를 더한다. `xpAt = now`.
3. 앞장: `pick` 이 박스에 있고 진화할 수 있으면 `lead = pick, chosen = true`. 지금 `lead` 가 박스에 없거나 진화할 수 없으면 `lead = null, chosen = false`. `lead` 가 없으면 `autoLead` 로 고르고 `chosen = false`.
4. 진화: `lead` 가 있고 `xp >= XP_PER_EVOLUTION_MS` 면 그 칸의 `species` 만 `evolutionOf` 로 바꾸고(나머지 필드 그대로) `xp = 0`, `evolving = { key, from, at: now }`, `seen` 에 넣는다. 진화한 종이 더 진화할 수 없으면 `lead = null, chosen = false`(다음 맞출 때 자동으로 고른다). 한 번 부를 때 한 단계만.
5. 전설: 진화한 종이 `LEGEND_FINALS` 에 있으면 그 새, `seen.length >= MEWTWO_DEX` 면 뮤츠, 1~150 이 모두 `seen` 이면 뮤. 아직 `legends` 에 없는 것만 박스 앞에 `{ key: \`legend:${species}\`, species, root, branch, label, at: now }` 로 넣는다. root/branch/label 은 진화한 칸의 것, 진화 없이 채운 조건이면 박스 맨 앞 칸의 것. `legends`, `seen` 에 넣는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** (`hooks/evolve-lib.test.ts`). 세션과 박스 칸을 만드는 헬퍼는 `nest-lib.test.ts` 의 `session` 과 같은 모양으로 둔다. 테스트 이름과 핵심 단언:
  - `일하는 세션만, 대시보드를 빼고 경험치를 쌓는다` — `xpAt = NOW - 60_000`, 세션 `working` 2개 + `waiting` 1개 + `working` 대시보드 1개 → `xp === 120_000`, `xpAt === NOW`.
  - `5분 넘게 끊긴 시간은 경험치로 세지 않는다` — `xpAt = NOW - 6 * 60_000` → `xp` 그대로. `xpAt = 0` 도 그대로.
  - `같은 종이 3마리 이상이면 그 종이 먼저 앞장서고, 아니면 가장 먼저 잡은 포켓몬이 앞장선다`
  - `진화할 수 없는 포켓몬은 앞장서지 않고, 앞장설 포켓몬이 없으면 경험치를 쌓아 둔다` — 박스에 6(리자몽), 128(켄타로스)만 → `lead === null`, `xp` 는 쌓인다.
  - `경험치가 차면 앞장선 포켓몬이 진화하고 잡은 시각과 라벨은 그대로다` — 박스 `{species: 19}`, `xp = XP_PER_EVOLUTION_MS` → 종 20, `evolved` 1개, `evolving.from === 19`.
  - `경험치가 많이 쌓여도 한 번에 한 단계만 진화하고 0 부터 다시 센다` — `xp = 10 * XP_PER_EVOLUTION_MS`, 박스 `{species: 4}` → 종 5, `xp === 0`.
  - `고른 포켓몬은 진화해도 계속 앞장서고 최종 진화형이 되면 풀린다` — 4 를 고르고 진화 → `lead` 같은 key, `chosen` true. 5→6 진화 뒤 `lead === null`, `chosen` false.
  - `앞장을 바꿔도 경험치는 남는다` — `xp = 1000`, `pick` 다른 key → `xp === 1000`.
  - `없는 포켓몬이나 진화할 수 없는 포켓몬을 앞장세우는 요청은 무시한다`
  - `이브이는 칸 key 로 셋 중 하나로 진화하고 같은 key 는 늘 같은 종이다`
  - `진화로 불꽃 최종 진화형을 처음 만들면 파이어가 한 번만 박스에 들어온다` — 5→6 진화 → `legends` 에 146, 박스에 `legend:146`. 다시 다른 칸이 38 이 돼도 두 번째는 없다.
  - `알에서 나온 최종 진화형은 새 조건에 들지 않는다` — 박스에 6 이 있고 진화 없음 → 146 없음.
  - `도감이 100종이면 뮤츠가, 뮤를 뺀 150종이면 뮤가 들어온다`
  - `예전 기록을 읽으면 도감은 박스로 채우고 박스에 있는 전설은 받은 것으로 친다` — `parsePokedex` 로 새 필드 없는 JSON(박스에 150 포함)을 읽고 `advanceEvolution` → `seen` 에 박스 종, `legends` 에 150, 뮤츠 칸이 하나 더 생기지 않음. 새 필드 기본값 `xp 0, xpAt 0, lead null, chosen false, seen [], legends [], evolving null`.
  - `조사를 받침에 맞춰 붙인다` — `withJosa('꼬렛','이/가') === '꼬렛이'`, `withJosa('레트라','으로/로') === '레트라로'`, `withJosa('리자몽','으로/로') === '리자몽으로'`, `withJosa('뮤츠','이/가') === '뮤츠가'`, `withJosa('No.6','이/가') === 'No.6가'`.
- [ ] **Step 2: 실패하는지 본다** — Run: `claude plugin test .` Expected: FAIL (모듈 없음).
- [ ] **Step 3: 타입, `emptyPokedex`, `parsePokedex` 를 넓히고 `hooks/evolve-lib.ts` 를 쓴다.** `parsePokedex` 는 숫자가 아니거나 배열이 아니면 기본값으로 읽는다.
- [ ] **Step 4: 통과하는지 본다** — Run: `claude plugin test .` Expected: 모두 PASS.
- [ ] **Step 5: 커밋** — `git commit -m "feat: 일한 시간으로 앞장선 박스 포켓몬이 진화하고 조건을 채우면 전설이 온다"`

---

### Task 3: 기록을 쓰는 세션이 진화를 맞추고 알린다

**Files:**
- Modify: `hooks/register.tsx` (`keepPokedex`, 새 `pickLead`, `readLeadRequest`)

**Interfaces:**
- Consumes: Task 2 의 `advanceEvolution`, `withJosa`, `evolutionOf`.
- Produces: `async function pickLead($: EngineInterface, key: string): Promise<void>` — `~/.claude/mod-hud-lead` 파일에 key 를 쓰고 `refreshSessions($)` 를 부른다. Task 5 의 버튼이 부른다. 상수 `const LEAD_FILE = '.claude/mod-hud-lead'`.

- [ ] **Step 1: `keepPokedex` 에서 `advancePokedex` 바로 뒤에 `advanceEvolution(dex, sessions, now, pick)` 을 부른다.** `pick` 은 `LEAD_FILE` 의 내용(없으면 null)이고, 읽은 뒤 지운다. 기록을 쓰는 세션이 아니면 파일을 건드리지 않는다.
- [ ] **Step 2: 토스트를 띄운다.**
  - 진화: `` `오잉!? ${withJosa(fromName, '이/가')} ${withJosa(toName, '으로/로')} 진화했다!` ``
  - 전설: `` `전설의 포켓몬 ${withJosa(name, '이/가')} PC 박스에 나타났다!` ``
  - 이름은 지금 `pokemonName($, home, species)` 로 얻는다.
- [ ] **Step 3: 확인** — Run: `claude plugin test .` Expected: 모두 PASS. `claude plugin validate .` Expected: `Validation passed`.
- [ ] **Step 4: 커밋** — `git commit -m "feat: 기록을 쓰는 세션이 경험치를 더하고 진화와 전설을 알린다"`

---

### Task 4: 알 몸통, 연두 반점 6가지, 오뚝이 흔들림

**Files:**
- Modify: `hooks/nest-lib.ts` (`EGG`, `drawEgg`, `drawSlot`, `WOBBLE`, `EGG_SLOT`, `EGG_ROWS`)
- Test: `hooks/nest-lib.test.ts`

**Interfaces:**
- Produces (`hooks/nest-lib.ts`):
  - `const EGG_BODY: string[]` — spec 의 14x13 몸통(반점 없음). 손봐도 크기는 14x13.
  - `const SPOTS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>>` — spec 의 무늬 6개, 순서 그대로.
  - `const ROCK = [0, -15, -25, -15, 0, 15, 25, 15, 0, -10, 0, 10, 0, 0, 0, 0, 0, 0]` (`WOBBLE` 를 바꾼다)
  - `export function eggSprite(key: string, stage: 'egg' | 'cracked', angle: number): string[]` — key 로 무늬(`hash(\`spots:${key}\`) % 6`)와 금(`hash(\`crack:${key}\`)`, 지금처럼)을 골라 몸통에 칠하고, `angle` 도만큼 돌린 행들을 돌려준다. 폭과 높이는 고정 `ROCK_WIDTH × ROCK_HEIGHT`(돌려도 잘리지 않는 크기, 예: 20×15)이고 바닥 줄이 알의 바닥이다. key, stage, angle 별로 캐시한다.

돌리는 방법은 시안 `wobble-v2.html` 의 `render` 를 옮긴다(이 계획에서 정하는 알고리즘이라 적어 둔다):

```ts
// 아랫면 곡률 중심(바닥에서 R = 폭/2 - 0.5 위)을 축으로 돌리고, 기운 쪽으로 R × 각도 × 0.4 만큼 굴린다
// 출력 칸마다 중심을 원본으로 되돌려 가장 가까운 칸을 읽는다. 1칸 외곽선은 돌리면 구멍이 나니,
// 모양만 돌리고 상하좌우 중 하나라도 비어 있는 칸을 외곽선(k)으로 다시 칠한다. 안쪽에 온 k 는 껍질(e)로 바꾼다
```

  금은 돌리기 전에 몸통에 칠해 함께 돌린다. 반점은 원 안의 `e`/`h` 칸을 `G`, `s` 칸을 `D` 로 칠한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `알은 14x13 몸통에 여섯 무늬 중 하나로 그리고, 같은 알은 늘 같은 무늬다` — `eggSprite('a', 'egg', 0)` 를 두 번 불러 같고, key 200개의 결과에서 서로 다른 그림이 6개다.
  - `기운 알도 외곽선에 구멍이 없고 바닥이 둥지에 닿는다` — 각도 `ROCK` 의 모든 값에서: 마지막 줄에 칠한 칸이 있고, 칠한 칸 중 상하좌우에 빈 칸이 닿은 칸은 모두 외곽선 색이다.
  - `금 간 알은 기울어도 금이 보인다` — `eggSprite(k, 'cracked', 25)` 에 금 색(`c`) 칸이 있다.
  - 지금 테스트 `금 간 알은 알마다 다섯 가지 금 중 하나로 그리고...` 와 `그림은 ... 프레임마다 움직인다` 는 새 그림에 맞게 고친다.
- [ ] **Step 2: 실패하는지 본다** — Run: `claude plugin test .` Expected: FAIL.
- [ ] **Step 3: 구현한다.** `drawSlot` 은 흔들리는 알이면 `ROCK[(frame + key.length) % ROCK.length]`, 아니면 0 도로 `eggSprite` 를 그린다. 기운 알이 옆 칸을 넘지 않게 `EGG_SLOT` 을 `ROCK_WIDTH` 이상으로, `EGG_ROWS * 2` 를 `ROCK_HEIGHT + 1` 이상으로 맞춘다.
- [ ] **Step 4: 통과하는지 본다** — Run: `claude plugin test .` Expected: 모두 PASS.
- [ ] **Step 5: 눈으로 본다** — `drawNest` 결과를 반 블록으로 찍어 보는 일회용 스크립트(이 계획 밖, 커밋하지 않음)로 각도 0, -25, 25 의 알을 보고 시안과 비슷한지 확인한다.
- [ ] **Step 6: 커밋** — `git commit -m "feat: 알을 둥글게 하고 연두 반점 여섯 가지 중 하나로 그리며 오뚝이처럼 흔든다"`

---

### Task 5: PC BOX 를 칸마다 그리고 한 줄 페이지, 앞장 표시, 진화 깜빡임

**Files:**
- Modify: `hooks/nest-lib.ts` (박스를 `drawNest` 에서 빼고 칸 그리기를 따로 둔다), `hooks/register.tsx` (PC BOX 머리줄, 칸 줄, 페이지 버튼, 앞장 버튼)
- Test: `hooks/nest-lib.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `Pokedex.lead`, `xp`, `evolving`, `evolutionOf`. Task 3 의 `pickLead`.
- Produces (`hooks/nest-lib.ts`):
  - `ICON_SIZE = 18`, `TILE = 20`, `TILE_ROWS = TILE / 2`, `BOX_ROWS_MAX = 1`
  - `NestInput` 에 `lead: string | null`, `evolving: Pokedex['evolving']` 를 더한다.
  - `nestRows` 와 `drawNest` 는 알 줄과 키우미집만 그린다(PC BOX 머리줄과 칸은 빠진다).
  - `export function boxOnPage(input: NestInput, width: number): BoxEntry[]` (지금 비공개 함수를 공개)
  - `export function boxPerRow(width: number): number` (공개, `Math.floor(width / TILE)`)
  - `export function drawBoxTile(entry: BoxEntry | null, isLead: boolean, evolving: Pokedex['evolving'], frame: number, now: number, lookup: SpriteLookup): Uint32Array` — 한 칸(TILE × TILE 픽셀, `TILE` 열 × `TILE_ROWS` 줄)의 셀. 벽 무늬, 18점 아이콘, 앞장이면 왼쪽 위에 작은 노란 별(3x3 정도). `evolving` 이 이 칸이고 `now - at < EVOLVE_MS`(`EVOLVE_MS = 4000`)면 두 프레임마다 진화 전(`evolving.from`)과 지금 종을 번갈아 그리고 반짝이를 더한다. `entry` 가 null 이면 벽만.
  - `export function boxPageOfKey(input: NestInput, width: number, key: string): number` — 진화한 칸이 있는 페이지.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `박스는 한 페이지에 한 줄이고 넘치면 페이지를 나눈다` — 폭 60(한 줄 3칸)에 7마리 → `boxPages === 3`, `boxOnPage` 첫 페이지 3마리.
  - `알 줄과 키우미집 그림에는 PC BOX 가 들어가지 않는다` — 박스가 있어도 `nestRows` 가 박스 없을 때와 같다.
  - `박스 칸은 18점 아이콘을 그리고 앞장이면 별을 단다` — 18보다 큰 가짜 스프라이트를 주고 `lookup` 이 `size === 18` 로 불린다. `isLead` 일 때만 별 색 칸이 있다.
  - `막 진화한 칸은 진화 전과 지금 그림을 번갈아 그리고 잠시 뒤 멈춘다` — `lookup` 이 종마다 다른 색을 돌려주고, `evolving.at = now` 에서 frame 0 과 2 의 그림이 다르며, `now = at + 5000` 에서는 frame 과 상관없이 같다.
  - 지금 테스트(`박스가 한 페이지를 넘으면...`, `그림은 알 줄, 키우미집, 박스를 합친 줄 수만큼...`, `금 간 알과 부화한 알, 박스 이번 페이지의 포켓몬만 스프라이트를 불러온다`)는 새 구조에 맞게 고친다. `speciesToLoad` 는 이번 페이지의 박스 칸과 그 칸들의 진화 전 종(깜빡임용)도 부른다.
- [ ] **Step 2: 실패하는지 본다** — Run: `claude plugin test .` Expected: FAIL.
- [ ] **Step 3: `nest-lib.ts` 를 구현한다.**
- [ ] **Step 4: `register.tsx` 를 바꾼다.** 알과 키우미집 Raster 아래에:
  - PC BOX 머리줄: `<Box backgroundColor="#3a6ea5">` 안 `Text` 한 줄. 왼쪽 `PC BOX`, 페이지가 여럿이면 ` 1/3`, 앞장이 있으면 `  ★{이름} {막대} {남은 시간}`, 오른쪽 끝에 박스 수(`#ffe080`). 막대는 `▓` 와 `░` 5칸, 남은 시간은 `formatFor(XP_PER_EVOLUTION_MS - xp)`. 앞장이 없으면 앞장 부분을 비운다.
  - 칸 줄: `boxPerRow` 개의 `<Box key={`tile-${i}`}>` 를 가로로 두고 각각 `<Raster key={`tile-${i}`} columns={TILE} rows={TILE_ROWS} cells=.../>`. 빈 칸은 `drawBoxTile(null, ...)`.
  - `tickNest` 는 `evolving` 이 `EVOLVE_MS` 안이면 그 칸 Raster 도 `$.ui.blit` 한다.
  - 새 `evolving.at` 을 처음 볼 때 `boxPage` 를 `boxPageOfKey` 로 옮긴다(같은 `at` 으로는 한 번만).
  - 페이지 버튼 줄(`◀ 이전`, `다음 ▶`)에 `앞장 ◀` / `앞장 ▶` 를 더한다. 박스 순서대로 진화할 수 있는 칸을 앞뒤로 골라 `pickLead` 를 부른다. 진화할 수 있는 칸이 하나도 없으면 앞장 버튼은 그리지 않는다. 페이지가 하나여도 앞장 버튼이 있으면 줄을 그린다.
- [ ] **Step 5: 통과하는지 본다** — Run: `claude plugin test .` Expected: 모두 PASS. `claude plugin validate .` Expected: `Validation passed`.
- [ ] **Step 6: 커밋** — `git commit -m "feat: PC BOX 를 한 줄 페이지에 18점 아이콘으로 그리고 앞장선 포켓몬과 진화를 보인다"`

---

### Task 6: 박스 칸 hover 카드

**Files:**
- Modify: `hooks/register.tsx`, `hooks/nest-lib.ts`

**Interfaces:**
- Consumes: Task 5 의 칸 `Box`, Task 3 의 `pickLead`, `evolutionOf`.
- Produces (`hooks/nest-lib.ts`): `export function drawPortrait(species: number, lookup: SpriteLookup): { columns: number; rows: number; cells: Uint32Array } | null` — 원본 아이콘(줄이지 않은 잘린 그림, `lookup(species, 40)`)을 반 블록 셀로. 그림이 없으면 null.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `원본 그림은 줄이지 않고 반 블록으로 그린다`: 30x24 가짜 스프라이트 → `columns === 30`, `rows === 12`.
- [ ] **Step 2: 실패하는지 본다** — Run: `claude plugin test .` Expected: FAIL.
- [ ] **Step 3: 구현한다.** 칸 `Box` 마다 `position="absolute"`, `display="none"`, `hover={{ display: 'flex' }}` 인 카드 Box 를 칸 위로 띄운다(`bottom` 이 칸 높이, 박스 오른쪽 끝 칸은 왼쪽으로 당겨 잘리지 않게). 카드: `drawPortrait` Raster, 이름(`pokemonName`), 잡은 날(`localDay(entry.at)`), 진화할 수 있으면 `→ {다음 이름}`(이브이는 `evolutionOf` 결과), 앞장이면 경험치 막대, 앞장이 아니고 진화할 수 있으면 `<Button key={`lead-${entry.key}`} label="앞장세우기" onPress={() => pickLead($, entry.key)} />`.
- [ ] **Step 4: 통과하는지 본다** — Run: `claude plugin test .` Expected: 모두 PASS.
- [ ] **Step 5: 사용자 iTerm 에서 확인한다.** `/reload-plugins` 뒤 `/mod-hud` 패널에서 박스 아이콘에 마우스를 올려 카드가 뜨는지, `앞장세우기` 가 눌리는지 사용자에게 확인을 부탁한다. 안 되면 결과를 그대로 보고하고 멈춘다(앞장 ◀ ▶ 는 Task 5 로 이미 된다).
- [ ] **Step 6: 커밋** — `git commit -m "feat: PC BOX 아이콘에 마우스를 올리면 원본 크기 카드와 앞장세우기 버튼이 뜬다"`

---

### Task 7: README 와 예시 화면

**Files:**
- Modify: `README.md`, `README.ko.md`, `docs/images/nest.png`

- [ ] **Step 1: README 의 포켓몬 알 섹션을 고친다.** 알에서는 진화 전 모습 74종만 나오고 전설은 나오지 않음, 일한 시간 3시간마다 앞장선 박스 포켓몬이 진화함, 앞장 고르기(hover 카드, `앞장 ◀ ▶`), 전설 조건 표, PC BOX 한 줄 페이지와 hover 카드. 두 README 를 같은 내용으로.
- [ ] **Step 2: 예시 화면을 새 그림으로 다시 찍는다.** `drawNest` 와 `drawBoxTile` 결과를 HTML 로 옮겨 headless Chrome 으로 찍는 일회용 스크립트(scratchpad, 커밋하지 않음)로 `docs/images/nest.png` 를 바꾼다. 일하는 알, 금 간 알, 부화한 포켓몬, 키우미집, PC BOX 한 줄(앞장 별 하나)이 보이게.
- [ ] **Step 3: 확인** — Run: `claude plugin validate .` Expected: `Validation passed`.
- [ ] **Step 4: 커밋** — `git commit -m "docs: 진화와 새 알 모양, PC BOX 를 README 에 적는다"`
