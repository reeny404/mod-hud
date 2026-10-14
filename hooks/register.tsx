import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, RenderElement } from 'claude-code'

import type {
  Attention,
  BackgroundTask,
  BoardEntry,
  BoxEntry,
  InboxCache,
  InboxItem,
  IssuesCache,
  Mr,
  Pokedex,
  Row,
  SessionStatus,
  TodoItem,
} from '../types'
import {
  applyFetch,
  categoryLabel,
  emptyCache,
  formatAgoShort,
  INBOX_TTL_MS,
  onlyForMe,
  parseCache,
  parseNotifications,
  shouldFetch,
  sortInbox,
  toastText,
} from './inbox-lib'
import {
  assignSessions,
  cleanupBlocker,
  emptyIssuesCache,
  findCheck,
  gitlabProjectApi,
  isLongLivedBranch,
  issuesFileOf,
  ISSUES_TTL_MS,
  mrAction,
  parseDefaultBranch,
  parseIssue,
  parseIssuesCache,
  parseWorktrees,
  readEnvValue,
} from './issues-lib'
import { canEvolve } from './dex-data'
import { advanceEvolution, TAKE_BACK, xpBar, xpLeft } from './evolve-lib'
import {
  advancePokedex,
  ARRIVAL_FRAMES,
  ARRIVAL_ROWS,
  boxOnPage,
  boxPageOf,
  boxPageOfKey,
  boxPages,
  boxPerRow,
  daycareGroundRows,
  drawArrival,
  drawBoxTile,
  drawDaycareGround,
  drawNest,
  drawPortrait,
  eggsOf,
  EVOLVE_MS,
  eggsOnScreen,
  emptyPokedex,
  keeperOf,
  localDay,
  nestRows,
  parsePokedex,
  speciesToLoad,
  TILE,
  TILE_ROWS,
  updatePending,
  WALKER_SIZE,
} from './nest-lib'
import type { NestInput, SpriteLookup } from './nest-lib'
import { crop, decodePng, fit } from './png-lib'
import type { Pixels } from './png-lib'
import {
  applyTaskUpdate,
  attentionAfterTurn,
  finishedTaskIds,
  firstLine,
  formatFor,
  freshness,
  isCodeReviewPrompt,
  launchedTaskId,
  pendingTasks,
  projectName,
  pickTitle,
  PRUNE_MS,
  summarizeTodos,
  transcriptPathOf,
  triage,
} from './sessions-lib'

const PANE = 'mod-hud'

// 섹션마다 아이콘과 색을 달리해 제목이 항목과 섞이지 않게 한다
const ICON = { mine: '⚑', running: '▶', mr: '⇄', inbox: '@', issues: '⎇' } as const
const COLOR = { mine: 'red', running: 'yellow', mr: 'blue', inbox: 'magenta', issues: 'cyan' } as const

const ATTENTION = {
  permission: { mark: '!', label: 'permission', color: 'red' },
  question: { mark: '?', label: 'question', color: 'yellow' },
  answered: { mark: '✓', label: 'done', color: 'green' },
} as const
const HEARTBEAT_MS = 60 * 1000
// 알과 박스 그림을 다시 칠하는 간격. 패널 전체가 아니라 그림만 칠하므로 짧아도 된다
const NEST_TICK_MS = 250
const SESSIONS_REFRESH_MS = 30 * 1000

// 세션 상태

// 모든 세션이 자기 상태를 여기 쓰고, 패널과 입력창 위 한 줄이 모아 읽는다
const STATUS_DIR = '.claude/mod-sessions'

const board = atom({ plugin: 'mod-hud', key: 'board' } as const, {
  mine: [],
  running: [],
  idle: [],
  hidden: { stale: 0, ended: 0 },
})
const sessionsMeta = atom({ plugin: 'mod-hud', key: 'sessionsMeta' } as const, {
  refreshedAt: null,
  ownId: null,
})

let dir: string | null = null
let mine: SessionStatus | null = null
// /clear 나 /resume 로 끝난 세션. 같은 창에서 이어지는 새 세션이 알과 대시보드 표시를 물려받는다
let handoff: { id: string; isDashboard: boolean } | null = null
let todos: TodoItem[] = []
let isRefreshing = false

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', ...args], { cwd })
    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

async function statusDir($: EngineInterface): Promise<string | null> {
  if (dir === null) {
    const home = await $.env.get('HOME')
    dir = home ? `${home}/${STATUS_DIR}` : null
  }
  return dir
}

async function readOwnStatus($: EngineInterface, path: string): Promise<SessionStatus | null> {
  try {
    return JSON.parse(await $.fs.read(path)) as SessionStatus
  } catch {
    return null
  }
}

async function writeStatus($: EngineInterface, patch: Partial<SessionStatus>) {
  try {
    const base = await statusDir($)
    if (!base) {
      return
    }
    const id = await $.session.id()
    // /clear 나 /resume 뒤 classic SessionStart 가 mod 에 오지 않을 때가 있어, 새 id 로 처음 쓸 때 끝난 세션을 이어 받는다
    const inherited = handoff && handoff.id !== id ? { predecessor: handoff.id, isDashboard: handoff.isDashboard } : {}
    if (handoff && handoff.id !== id) {
      // 끝난 세션의 요청, 상태는 새 세션 것이 아니다
      mine = null
      handoff = null
    }
    const cwd = await $.session.cwd()
    const repo = await $.session.repo()
    const root = repo?.root ?? cwd
    const updatedAt = await $.clock.now()
    // mod 가 다시 로드되면 모듈 변수가 비므로, 대기 시작 시각과 브랜치는 이전 상태 파일에서 이어 받는다
    const prev = mine ?? (await readOwnStatus($, `${base}/${id}.json`))
    // 세션들이 checkout 하나를 같이 쓰면 다른 세션이 브랜치를 바꾼다. 이 세션이 일을 시작하거나 끝낼 때 본 브랜치만 남긴다
    const isWorkEdge = patch.state === 'working' || (patch.state === 'waiting' && prev?.state === 'working')
    const branch =
      isWorkEdge || !prev ? (await git($, cwd, ['branch', '--show-current']))?.trim() || null : prev.branch
    const state = patch.state ?? prev?.state ?? 'waiting'
    const waitingSince =
      state !== 'waiting' ? undefined : prev?.state === 'waiting' ? (prev.waitingSince ?? updatedAt) : updatedAt
    mine = {
      state: 'waiting',
      prompt: null,
      todos: null,
      // 대시보드 표시, 리뷰 세션 표시와 MR 상태는 mod 를 다시 로드해도 이어 간다
      isDashboard: prev?.isDashboard,
      isCodeReview: prev?.isCodeReview,
      mrState: prev?.mrState,
      mrBranch: prev?.mrBranch,
      ...mine,
      ...inherited,
      ...patch,
      id,
      cwd,
      root,
      project: projectName(root),
      branch,
      updatedAt,
      waitingSince,
      // 브랜치가 없으면 MR 도 없다. 저장소 밖 세션은 MR 을 조회하지 않으므로 여기서 적어 둔다
      ...(branch === null ? { mrState: null, mrBranch: null } : {}),
    }
    await $.fs.write(`${base}/${id}.json`, JSON.stringify(mine))
  } catch {
    // 상태 기록이 실패해도 세션 동작은 막지 않는다
  }
}

// 이만큼 지나도 그대로면 OS 알림을 보낸다. 보고 있는 세션에서 바로 답할 때는 알림이 쌓이지 않는다
const NOTIFY_DELAY_MS = 60 * 1000
// 입력창 위에 풀어 보일 내 차례 줄 수
const BAND_SHOWN = 3

// 나를 기다리기 시작한 세션이 스스로 알린다. 다른 세션은 알리지 않으므로 같은 알림이 겹치지 않는다
async function setAttention($: EngineInterface, attention: Attention | null) {
  await writeStatus($, { attention })
  if (!attention) {
    return
  }
  void (async () => {
    await $.clock.sleep(NOTIFY_DELAY_MS)
    const now = mine?.attention
    if (!mine || now?.kind !== attention.kind || now.since !== attention.since) {
      return
    }
    const name = mine.title ?? (mine.branch && parseIssue(mine.branch)) ?? mine.branch ?? mine.project
    const body = attention.text ?? mine.prompt
    await $.ui.notify(`${name} ${ATTENTION[attention.kind].label}${body ? `: ${body}` : ''}`, { title: mine.project })
  })().catch(() => undefined)
}

// 아직 끝나지 않은 백그라운드 작업. mod 가 다시 로드돼 mine 이 비었으면 상태 파일에서 읽는다
async function backgroundTasks($: EngineInterface): Promise<BackgroundTask[]> {
  if (mine) {
    return mine.background ?? []
  }
  const base = await statusDir($)
  const own = base ? await readOwnStatus($, `${base}/${await $.session.id()}.json`) : null
  return own?.background ?? []
}

// 답은 끝났지만 백그라운드 작업을 기다리는 세션. 확인 대기 대신 진행 중에 두고, heartbeat 가 작업이 끝났는지 다시 본다
async function keepWorking($: EngineInterface) {
  await writeStatus($, { state: 'working', attention: null, waitingOnTasks: true })
}

// classic hook 이 알려 준 transcript 경로. mod 가 다시 로드된 직후에는 비어 있어 규칙으로 만든다
let transcriptPath: string | null = null

async function ownTranscript($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME')
  return transcriptPath ?? (home ? transcriptPathOf(home, await $.session.root(), await $.session.id()) : null)
}

// 끝났다는 알림이 prompt.submit 을 거치지 않고 올 때가 있다. 턴 도중에 와서 queued_command 로 붙거나, 결과가 <agent-message> 로 먼저 온 경우다
// 그래서 transcript 에서 그 작업 id 가 나온 줄만 grep 으로 뽑아 끝난 작업을 찾는다
async function finishedInTranscript($: EngineInterface, tasks: readonly BackgroundTask[]): Promise<string[]> {
  try {
    const path = await ownTranscript($)
    if (!path || tasks.length === 0) {
      return []
    }
    const found = await $.process.run(['grep', '-F', ...tasks.flatMap(task => ['-e', task.id]), path])
    return finishedTaskIds(found.stdout)
  } catch {
    return []
  }
}

// 끝났거나 너무 오래된 작업을 지우고 남은 작업을 돌려준다. transcript 까지 보는 것은 턴이 끝났을 때만이다
async function settleBackground($: EngineInterface, now: number, withTranscript: boolean): Promise<BackgroundTask[]> {
  const tasks = await backgroundTasks($)
  const finished = withTranscript ? await finishedInTranscript($, pendingTasks(tasks, now)) : []
  const pending = pendingTasks(tasks, now, finished)
  if (pending.length !== tasks.length) {
    await writeStatus($, { background: pending })
  }
  return pending
}

// 1분마다 살아 있다고 남긴다. 백그라운드 작업만 기다리던 세션은 작업이 다 끝났으면 내 차례로 넘긴다
async function heartbeat($: EngineInterface) {
  const now = await $.clock.now()
  const isWaitingOnTasks = mine?.state === 'working' && mine.waitingOnTasks === true
  const pending = await settleBackground($, now, isWaitingOnTasks)
  if (isWaitingOnTasks && pending.length === 0) {
    await writeStatus($, { state: 'waiting', waitingOnTasks: false })
    await setAttention($, { kind: 'answered', since: now, text: null })
    return
  }
  await writeStatus($, {})
}

// /resume 목록에 보이는 이름을 transcript 에서 읽는다. 파일이 커서 이름 줄만 grep 으로 뽑는다
async function readTitle($: EngineInterface): Promise<string | null> {
  try {
    const path = await ownTranscript($)
    if (!path) {
      return null
    }
    const found = await $.process.run(['grep', '-E', '"type":"(custom-title|ai-title)"', path])
    return pickTitle(found.stdout)
  } catch {
    return null
  }
}

// 클릭한 MR 이나 Linear 알림을 기본 브라우저로 연다
function openUrl($: EngineInterface, url: string | null | undefined) {
  if (url) {
    void $.process.run(['open', url]).catch(() => undefined)
  }
}

const currentTodos = (): TodoItem[] => todos

async function setTodos($: EngineInterface, next: TodoItem[]) {
  todos = next
  await writeStatus($, { todos: summarizeTodos(todos) })
}

async function readSessions($: EngineInterface): Promise<SessionStatus[]> {
  const base = await statusDir($)
  if (!base || !(await $.fs.exists(base))) {
    return []
  }
  const now = await $.clock.now()
  const sessions: SessionStatus[] = []
  for (const entry of await $.fs.list(base)) {
    if (!entry.name.endsWith('.json')) {
      continue
    }
    const path = `${base}/${entry.name}`
    if (now - entry.mtimeMs > PRUNE_MS) {
      await $.process.run(['rm', '-f', path]).catch(() => undefined)
      continue
    }
    try {
      sessions.push(JSON.parse(await $.fs.read(path)) as SessionStatus)
    } catch {
      // 쓰는 도중이면 다음 갱신 때 읽는다
    }
  }
  return sessions
}

async function refreshSessions($: EngineInterface) {
  if (isRefreshing) {
    return
  }
  isRefreshing = true
  try {
    const now = await $.clock.now()
    const merged = Object.entries(await read($, branchMrs)).flatMap(([branch, mr]) => (mr.state === 'merged' ? [branch] : []))
    const sessions = await readSessions($)
    const next = triage(sessions, mine?.id ?? null, now, new Set(merged))
    await update($, board, () => next)
    await keepPokedex($, sessions, now).catch(() => undefined)
    await update($, sessionsMeta, () => ({ refreshedAt: now, ownId: mine?.id ?? null }))
  } finally {
    isRefreshing = false
  }
}

// 저장소의 worktree 와 MR

// plugin.json 의 userConfig. register 가 받은 값으로 채운다
const config = { gitlabUrl: '', baseBranch: '', autoCleanup: false }

const LINEAR_TTL_MS = 5 * 60 * 1000
// 파일을 읽어 조회 주기가 됐는지 보는 간격. 파일만 읽으므로 짧아도 된다
const ISSUES_CHECK_MS = 30 * 1000

const rows = atom({ plugin: 'mod-hud', key: 'rows' } as const, [])
const branchMrs = atom({ plugin: 'mod-hud', key: 'branchMrs' } as const, {})
const issuesMeta = atom({ plugin: 'mod-hud', key: 'issuesMeta' } as const, {
  refreshedAt: null,
  isRefreshing: false,
  log: [],
})

// 세션이 열린 git 저장소. api 는 GitLab 프로젝트 API 주소이고 GitLab 이 아니면 null, base 는 커밋 수를 셀 기준 브랜치
type RepoInfo = { root: string; api: string | null; base: string }

// undefined 는 아직 안 봄, null 은 git 저장소가 아님
let repoInfo: RepoInfo | null | undefined
const linearCache = new Map<string, { status: string | null; at: number }>()

async function ensureRepo($: EngineInterface): Promise<RepoInfo | null> {
  if (repoInfo === undefined) {
    const repo = await $.session.repo()
    if (!repo) {
      repoInfo = null
    } else {
      const head = config.baseBranch ? null : await git($, repo.root, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
      repoInfo = {
        root: repo.root,
        api: repo.remote ? gitlabProjectApi(repo.remote, config.gitlabUrl) : null,
        base: config.baseBranch || (head && parseDefaultBranch(head)) || 'main',
      }
    }
  }
  return repoInfo
}

// 환경 변수 GITLAB_TOKEN 을 먼저 보고, 없으면 저장소의 .env.local 에서 읽는다
async function readToken($: EngineInterface, root: string): Promise<string | null> {
  const fromEnv = await $.env.get('GITLAB_TOKEN').catch(() => undefined)
  if (fromEnv) {
    return fromEnv
  }
  try {
    return readEnvValue(await $.fs.read(`${root}/.env.local`), 'GITLAB_TOKEN')
  } catch {
    return null
  }
}

async function fetchMr($: EngineInterface, api: string, token: string, branch: string): Promise<Mr | null> {
  const query = `source_branch=${encodeURIComponent(branch)}&order_by=updated_at&per_page=1`
  const res = await $.http.fetch(`${api}/merge_requests?${query}`, {
    headers: { 'PRIVATE-TOKEN': token },
  })
  if (!res.ok) {
    return null
  }
  const [mr] = JSON.parse(res.text) as Array<Parameters<typeof mrAction>[0] & { iid: number; sha: string; web_url: string }>
  return mr ? { iid: mr.iid, state: mr.state, sha: mr.sha, url: mr.web_url, action: mrAction(mr) } : null
}

async function fetchLinear($: EngineInterface, issue: string, now: number): Promise<string | null> {
  const cached = linearCache.get(issue)
  if (cached && now - cached.at < LINEAR_TTL_MS) {
    return cached.status
  }
  let status: string | null = null
  try {
    const result = await $.mcp.call('claude.ai Linear', 'get_issue', { id: issue, fields: ['status'] })
    const text = result.content.find(block => block.type === 'text')?.text
    const parsed = text ? (JSON.parse(text) as { status?: string | { name?: string } }) : null
    status = typeof parsed?.status === 'string' ? parsed.status : (parsed?.status?.name ?? null)
  } catch {
    // Linear 연결이 없으면 상태 없이 보인다
  }
  linearCache.set(issue, { status, at: now })
  return status
}

// MR 이 머지됐고 남은 작업이 없는 worktree 를 지운다. 지웠으면 기록할 한 줄을 돌려준다
async function cleanup($: EngineInterface, root: string, row: Row): Promise<string | null> {
  const removed = await $.process.run(['git', 'worktree', 'remove', row.path], { cwd: root })
  if (removed.exitCode !== 0) {
    row.note = `cleanup failed: ${removed.stderr.trim().split('\n')[0] ?? ''}`
    return null
  }
  // head 가 MR 의 sha 와 같다는 걸 확인했으므로 squash 머지여도 -D 로 지운다
  if (row.branch) {
    await $.process.run(['git', 'branch', '-D', row.branch], { cwd: root })
  }
  const name = row.issue ? `#${row.issue}` : (row.branch ?? row.path)
  // 하루 넘게 대기하던 세션은 지운 폴더에 남으므로 닫으라고 알린다
  const left = row.session ? ', close its idle session' : ''
  $.ui.toast(`${name} MR merged, worktree cleaned up${left}`)
  return `${name}: removed worktree and branch${left}`
}

// git, GitLab, Linear 를 불러 worktree 목록을 새로 만든다. 조회를 맡은 세션만 부른다
async function collectIssues($: EngineInterface, { root, api, base }: RepoInfo, now: number) {
  const listed = await $.process.run(['git', 'worktree', 'list', '--porcelain'], { cwd: root })
  const trees = parseWorktrees(listed.stdout)
  const allSessions = await readSessions($)
  const sessions = assignSessions(trees, allSessions, now)
  const token = api ? await readToken($, root) : null
  const findMr = (branch: string) => (api && token ? fetchMr($, api, token, branch) : null)
  const ownCwd = await $.session.cwd()

  const next: Row[] = []
  const log: string[] = []
  for (const tree of trees) {
    const [ahead, dirty] = await Promise.all([
      $.process.run(['git', 'rev-list', '--count', `origin/${base}..HEAD`], { cwd: tree.path }),
      $.process.run(['git', 'status', '--porcelain'], { cwd: tree.path }),
    ])
    const issue = tree.branch ? parseIssue(tree.branch) : null
    const row: Row = {
      ...tree,
      issue,
      ahead: Number(ahead.stdout.trim()) || 0,
      dirty: dirty.stdout.split('\n').filter(Boolean).length,
      session: sessions.get(tree.path) ?? null,
      mr: tree.branch ? await findMr(tree.branch) : null,
      linear: issue && issue.includes('-') ? await fetchLinear($, issue, now) : null,
      note: null,
    }

    // 자동 정리는 worktree 와 브랜치를 지우므로 autoCleanup 을 켠 사람만 한다
    if (config.autoCleanup) {
      const blocker = cleanupBlocker(row, allSessions, ownCwd, now)
      const removed = blocker === null ? await cleanup($, root, row) : null
      if (removed !== null) {
        log.push(removed)
        continue
      }
      if (blocker !== null && blocker !== 'not-merged') {
        row.note = `merged, cleanup on hold: ${blocker}`
      }
    }
    next.push(row)
  }

  // worktree 가 아닌 브랜치에서 일한 세션도 MR 을 찾는다. 세션 줄의 MR 링크와 머지 여부에 쓴다
  const known = new Map(next.map(row => [row.branch, row.mr]))
  const found: Record<string, Mr> = {}
  // MR 을 찾아본 브랜치. 세션은 여기 있는 브랜치의 MR 상태만 상태 파일에 적는다
  const checked = new Set<string>()
  for (const branch of new Set(allSessions.filter(s => s.state !== 'ended').map(s => s.branch))) {
    if (!branch || isLongLivedBranch(branch, base)) {
      continue
    }
    const mr = known.has(branch) ? known.get(branch) : await findMr(branch)
    checked.add(branch)
    if (mr) {
      found[branch] = mr
    }
  }
  return { rows: next, branchMrs: found, checked: [...checked], log }
}

async function readIssuesCache($: EngineInterface, path: string): Promise<IssuesCache> {
  try {
    return parseIssuesCache(await $.fs.read(path))
  } catch {
    return emptyIssuesCache()
  }
}

let isIssuesRefreshing = false

// 파일이 2분 안이면 파일만 읽고, 아니면 한 세션만 조회해 파일에 쓴다. isForced 는 새로고침 버튼
async function refreshIssues($: EngineInterface, isForced: boolean) {
  const repo = await ensureRepo($)
  const home = await $.env.get('HOME')
  if (!repo || !home || isIssuesRefreshing) {
    return
  }
  isIssuesRefreshing = true
  try {
    // 다른 저장소의 세션과 섞이지 않게 저장소마다 파일을 따로 둔다
    const path = `${home}/.claude/${issuesFileOf(repo.root)}`
    const me = await $.session.id()
    let cache = await readIssuesCache($, path)
    // 이 세션 브랜치의 MR 을 아직 찾아보지 않았으면 주기를 기다리지 않고 조회한다. 그 전까지 이 세션은 알을 받지 않는다
    const isUnchecked = (branch: string | null | undefined) =>
      !!branch && !isLongLivedBranch(branch, repo.base) && !cache.checked.includes(branch)

    if (shouldFetch(cache, await $.clock.now(), me, isForced || isUnchecked(mine?.branch), ISSUES_TTL_MS)) {
      // 파일에 이 세션이 맡는다고 써 두고, 잠깐 뒤 다시 읽어 그대로일 때만 부른다. 나중에 쓴 세션이 맡는다
      await $.fs.write(path, JSON.stringify({ ...cache, lease: { by: me, at: await $.clock.now() } }))
      await $.clock.sleep(LEASE_SETTLE_MS)
      const claimed = await readIssuesCache($, path)
      if (claimed.lease?.by === me) {
        await update($, issuesMeta, prev => ({ ...prev, isRefreshing: true }))
        const now = await $.clock.now()
        try {
          const collected = await collectIssues($, repo, now)
          cache = { fetchedAt: now, ...collected, log: [...collected.log, ...claimed.log].slice(0, 5), lease: null }
        } catch {
          // 실패해도 fetchedAt 을 남겨 모든 세션이 주기 동안 다시 부르지 않게 한다. 본 목록은 그대로 둔다
          cache = { ...claimed, fetchedAt: now, lease: null }
        }
        await $.fs.write(path, JSON.stringify(cache))
      } else {
        cache = claimed
      }
    }

    await update($, rows, () => cache.rows)
    await update($, branchMrs, () => cache.branchMrs)
    await update($, issuesMeta, () => ({ refreshedAt: cache.fetchedAt, isRefreshing: false, log: cache.log }))
    // 포켓몬 알이 금 가고 부화하는 기준이라, 이 세션 브랜치의 MR 상태를 조회한 브랜치와 함께 상태 파일에 적어 다른 세션도 보게 한다
    // 아직 찾아보지 않은 브랜치는 적지 않는다. 다른 브랜치를 보고 적은 상태는 모르는 것으로 친다
    const branch = mine?.branch ?? null
    if (mine && !isUnchecked(branch)) {
      const mrState = branch ? (cache.branchMrs[branch]?.state ?? null) : null
      if ((mine.mrState ?? null) !== mrState || mine.mrBranch !== branch) {
        await writeStatus($, { mrState, mrBranch: branch })
      }
    }
  } catch {
    // 이슈를 못 읽어도 다른 패널 동작은 막지 않는다
  } finally {
    isIssuesRefreshing = false
    await update($, issuesMeta, prev => ({ ...prev, isRefreshing: false }))
  }
}

// 포켓몬 알과 박스

// 부화, 키우미집, 박스 기록. 열린 세션 중 id 가 가장 작은 세션만 쓰고, 모든 세션이 읽는다
const POKEDEX_FILE = '.claude/mod-hud-pokedex.json'
// 박스로 보내기 요청. 어느 세션에서 눌러도 알 key 이름의 빈 파일을 두고, 기록을 쓰는 세션이 읽어 박스에 넣은 뒤 지운다
const SENDBOX_DIR = '.claude/mod-hud-sendbox'
// 앞장세우기 요청. 어느 세션에서 눌러도 박스 칸 key 를 이 파일에 쓰고, 기록을 쓰는 세션이 읽어 반영한 뒤 지운다
const LEAD_FILE = '.claude/mod-hud-lead'
// 세션이 닫힌 뒤 머지를 기다리는 알의 MR 을 다시 조회하는 간격
const PENDING_CHECK_MS = 2 * 60 * 1000

const pokedex = atom({ plugin: 'mod-hud', key: 'pokedex' } as const, emptyPokedex())
const eggs = atom({ plugin: 'mod-hud', key: 'eggs' } as const, [])

let pendingCheckedAt = 0

async function readPokedex($: EngineInterface, home: string): Promise<Pokedex> {
  try {
    return parsePokedex(await $.fs.read(`${home}/${POKEDEX_FILE}`))
  } catch {
    return emptyPokedex()
  }
}

// 닫힌 세션의 브랜치는 그 세션의 저장소 remote 와 토큰으로 MR 을 다시 조회한다
async function refreshPending($: EngineInterface, dex: Pokedex): Promise<Pokedex> {
  let next = dex
  for (const egg of dex.pending) {
    if (egg.mrState !== 'opened' || !egg.branch) {
      continue
    }
    try {
      const remote = (await git($, egg.root, ['remote', 'get-url', 'origin']))?.trim()
      const api = remote ? gitlabProjectApi(remote, config.gitlabUrl) : null
      const token = api ? await readToken($, egg.root) : null
      const mr = api && token ? await fetchMr($, api, token, egg.branch) : null
      if (mr && mr.state !== egg.mrState) {
        next = updatePending(next, egg.key, mr.state)
      }
    } catch {
      // 조회하지 못하면 다음 주기에 다시 본다
    }
  }
  return next
}

async function sendToBox($: EngineInterface, key: string) {
  const home = await $.env.get('HOME')
  if (!home) {
    return
  }
  const dir = `${home}/${SENDBOX_DIR}`
  await $.process.run(['mkdir', '-p', dir])
  await $.fs.write(`${dir}/${key}`, '')
  // 기록을 쓰는 세션이 다음 조회 때 넣으므로, 그동안 이 패널에서는 바로 빼 둔다
  await update($, eggs, prev => prev.filter(egg => egg.key !== key))
  void refreshSessions($)
}

async function pickLead($: EngineInterface, key: string) {
  const home = await $.env.get('HOME')
  if (!home) {
    return
  }
  await $.fs.write(`${home}/${LEAD_FILE}`, key)
  void refreshSessions($)
}

async function readLeadRequest($: EngineInterface, home: string): Promise<string | null> {
  try {
    const path = `${home}/${LEAD_FILE}`
    return (await $.fs.exists(path)) ? (await $.fs.read(path)).trim() || null : null
  } catch {
    return null
  }
}

async function readSendRequests($: EngineInterface, home: string): Promise<string[]> {
  const dir = `${home}/${SENDBOX_DIR}`
  try {
    return (await $.fs.exists(dir)) ? (await $.fs.list(dir)).map(entry => entry.name) : []
  } catch {
    return []
  }
}

// 세션 목록을 읽을 때마다 기록을 맞춘다. 기록을 쓰는 세션만 파일을 바꾸고 토스트를 띄운다
async function keepPokedex($: EngineInterface, sessions: SessionStatus[], now: number) {
  const home = await $.env.get('HOME')
  if (!home) {
    return
  }
  let dex = await readPokedex($, home)
  if (keeperOf(sessions, now) === (await $.session.id())) {
    const before = JSON.stringify(dex)
    if (now - pendingCheckedAt >= PENDING_CHECK_MS) {
      pendingCheckedAt = now
      dex = await refreshPending($, dex)
    }
    const requests = await readSendRequests($, home)
    const advanced = advancePokedex(dex, sessions, now, requests)
    const pick = await readLeadRequest($, home)
    const grown = advanceEvolution(advanced.dex, sessions, now, pick)
    dex = grown.dex
    if (JSON.stringify(dex) !== before) {
      await $.fs.write(`${home}/${POKEDEX_FILE}`, JSON.stringify(dex))
    }
    // 부화하지 않은 알의 요청은 버튼이 없어 생기지 않으니, 읽은 요청은 모두 지운다
    for (const name of requests) {
      await $.process.run(['rm', '-f', `${home}/${SENDBOX_DIR}/${name}`])
    }
    if (pick !== null) {
      await $.process.run(['rm', '-f', `${home}/${LEAD_FILE}`])
    }
    for (const egg of advanced.born) {
      $.ui.toast(`Your ${egg.label} egg hatched into ${await pokemonName($, home, egg.species)}!`)
    }
    for (const egg of advanced.boxed) {
      $.ui.toast(`${await pokemonName($, home, egg.species)} was sent to the PC BOX (${egg.label})`)
    }
    for (const egg of advanced.left) {
      $.ui.toast(`Left the ${egg.label} egg at the DAY CARE`)
    }
    for (const egg of advanced.given) {
      $.ui.toast(`Got an egg from the DAY CARE for ${egg.label}`)
    }
    for (const { entry, from } of grown.evolved) {
      $.ui.toast(`What? ${await pokemonName($, home, from)} evolved into ${await pokemonName($, home, entry.species)}!`)
    }
    for (const entry of grown.legends) {
      $.ui.toast(`The legendary ${await pokemonName($, home, entry.species)} appeared in the PC BOX!`)
    }
  }
  await update($, pokedex, () => dex)
  const next = eggsOf(sessions, dex, now)
  // 30초마다 부르므로 그대로면 쓰지 않아 패널을 괜히 다시 그리지 않는다
  await update($, eggs, prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
}

// 포켓몬 그림과 이름은 PokeAPI 에서 처음 쓸 때 한 번 받아 이 폴더에 두고 다시 쓴다
const SPRITE_DIR = '.claude/mod-hud-sprites'
// 7세대 박스 아이콘. 처음부터 작게 그린 도트라 줄이지 않아도 돼 뭉개지지 않는다
const spriteUrl = (species: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-vii/icons/${species}.png`
const speciesUrl = (species: number) => `https://pokeapi.co/api/v2/pokemon-species/${species}`

// 읽은 그림은 투명한 테두리를 잘라 둔다. null 은 받은 파일이 깨져 이 세션에서는 다시 읽지 않는 것
const sprites = new Map<number, Pixels | null>()
const fitted = new Map<string, Pixels>()
const spritesLoading = new Set<number>()

const lookupSprite: SpriteLookup = (species, size) => {
  const key = `${species}:${size}`
  const cached = fitted.get(key)
  if (cached) {
    return cached
  }
  const source = sprites.get(species)
  if (!source) {
    return undefined
  }
  const made = fit(source, size)
  fitted.set(key, made)
  return made
}

// 금 간 알과 박스에 보이는 포켓몬만 부른다. 받지 못하면 그동안 몬스터볼을 그리고 다음 그릴 때 다시 받는다
async function loadSprite($: EngineInterface, species: number) {
  if (sprites.has(species) || spritesLoading.has(species)) {
    return
  }
  spritesLoading.add(species)
  try {
    const home = await $.env.get('HOME')
    if (!home) {
      return
    }
    const path = `${home}/${SPRITE_DIR}/icons/${species}.png`
    if (!(await $.fs.exists(path))) {
      const got = await $.process.run(['curl', '-fsSL', '--create-dirs', '-o', path, spriteUrl(species)])
      if (got.exitCode !== 0) {
        return
      }
    }
    const { base64 } = await $.fs.read(path, { as: 'bytes' })
    // 엔진의 Uint8Array 는 fromBase64 를 갖지만 TypeScript 의 lib 에는 아직 없다
    const bytes = (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(base64)
    try {
      sprites.set(species, crop(decodePng(bytes)))
    } catch {
      // 받다 끊긴 파일은 지워 다음 세션에서 다시 받게 한다
      sprites.set(species, null)
      await $.process.run(['rm', '-f', path])
    }
  } catch {
    // 네트워크나 파일을 못 쓰면 몬스터볼로 둔다
  } finally {
    spritesLoading.delete(species)
  }
}

// 영어 이름. 파일에서 한 번 읽어 메모리에 두고, 모르는 이름은 PokeAPI 에서 받아 파일에 더한다
const names = new Map<number, string>()
// 이 세션에서 받으려다 실패한 종. 패널을 그릴 때마다 네트워크를 다시 부르지 않는다
const namesFailed = new Set<number>()
const namesLoading = new Map<number, Promise<string | null>>()
let namesRead: Promise<void> | null = null

function readNames($: EngineInterface, home: string): Promise<void> {
  namesRead ??= (async () => {
    try {
      const saved = JSON.parse(await $.fs.read(`${home}/${SPRITE_DIR}/names-en.json`)) as Record<string, string>
      for (const [species, name] of Object.entries(saved)) {
        names.set(Number(species), name)
      }
    } catch {
      // 처음이면 파일이 없다
    }
  })()
  return namesRead
}

function fetchName($: EngineInterface, home: string, species: number): Promise<string | null> {
  const loading = namesLoading.get(species)
  if (loading) {
    return loading
  }
  const made = (async () => {
    try {
      const res = await $.http.fetch(speciesUrl(species))
      const parsed = res.ok ? (JSON.parse(res.text) as { names?: { name: string; language: { name: string } }[] }) : null
      const name = parsed?.names?.find(one => one.language.name === 'en')?.name
      if (!name) {
        namesFailed.add(species)
        return null
      }
      names.set(species, name)
      await $.fs.write(`${home}/${SPRITE_DIR}/names-en.json`, JSON.stringify(Object.fromEntries(names)))
      return name
    } catch {
      namesFailed.add(species)
      return null
    } finally {
      namesLoading.delete(species)
    }
  })()
  namesLoading.set(species, made)
  return made
}

// 토스트에 쓰는 이름. 받을 때까지 기다리고, 못 받으면 도감 번호로 부른다
async function pokemonName($: EngineInterface, home: string, species: number): Promise<string> {
  await readNames($, home)
  const known = names.get(species) ?? (namesFailed.has(species) ? null : await fetchName($, home, species))
  return known ?? `No.${species}`
}

// 패널에 쓰는 이름. 기다리지 않고 지금 아는 이름을 쓰며, 모르면 도감 번호로 그리고 받은 뒤 다시 그린다
async function shownName($: EngineInterface, home: string, species: number): Promise<string> {
  await readNames($, home)
  const known = names.get(species)
  if (known) {
    return known
  }
  if (!namesFailed.has(species)) {
    void fetchName($, home, species).then(name => {
      if (name) {
        $.ui.invalidate('ui.render')
      }
    })
  }
  return `No.${species}`
}

// 패널이 그린 알과 박스의 크기와 내용. 패널이 그릴 때마다 바꾸고, 칠할 수 없으면 비운다
let nestScene: { columns: number; rows: number; input: NestInput } | null = null
// 보고 있는 박스 페이지. 0부터 센다
let boxPage = 0
// 이 패널이 마지막으로 본 진화의 시각(기록에 적힌 것)과 그 진화를 처음 본 이 세션의 시각
// 진화는 기록을 쓰는 세션이 적고 다른 세션은 30초마다 읽으므로, 깜빡임은 이 세션이 처음 본 때부터 센다
let evolvingSeen = 0
let evolvingSeenAt = 0
// 이보다 오래된 진화는 처음 봐도 깜빡이지 않는다. 다른 세션이 기록을 읽는 간격보다 넉넉하다
const EVOLVING_FRESH_MS = 60 * 1000
// 이 패널이 마지막으로 본 전설 등장(기록에 적힌 시각)과, 그 등장 장면을 처음 보인 이 세션의 시각
let arrivalSeen = 0
let arrivalShown: { species: number; at: number; name: string } | null = null
const ARRIVAL_COLUMNS = 60

// 지금 보일 등장 장면의 걸음. 끝났으면 null
function arrivalStep(now: number): number | null {
  if (!arrivalShown) {
    return null
  }
  const step = Math.floor((now - arrivalShown.at) / NEST_TICK_MS)
  return step < ARRIVAL_FRAMES ? step : null
}

function arrivalCells(columns: number, now: number): string {
  const shown = arrivalShown!
  return base64Of(drawArrival(shown.species, shown.name, Math.min(columns, ARRIVAL_COLUMNS), arrivalStep(now) ?? 0, lookupSprite))
}
// PC BOX 와 DAY CARE 머리줄의 글자. 박스 수와, 키우미집에 맡겨 키우는 포켓몬의 경험치. ★ 와 막대는 Raster 가 못 그려 Text 로 그린다
let boxHeader: { count: number; lead: string | null } = { count: 0, lead: null }
// PC BOX 를 접었는지. 접으면 머리줄만 보인다
let boxCollapsed = false
// 마지막으로 그린 키우미집 풀밭 줄 수. 칠할 때 줄 수가 바뀌었으면 다시 그린다
let daycareRowsDrawn = 0
// 키우미집을 접었는지. 접으면 머리줄의 맡긴 포켓몬 경험치와 남은 알 수만 보인다
let daycareCollapsed = false
// 박스 칸에 마우스를 올리면 뜨는 카드의 글자. 칸 key 로 찾는다
let boxCards = new Map<string, { name: string; caught: string; canLead: boolean }>()
// 카드 폭. 원본 아이콘 40칸과 테두리
const CARD_COLUMNS = 42
// 카드는 아래 화면 위에 겹쳐 뜨므로 빈 칸까지 이 색으로 칠해 비치지 않게 한다
const CARD_BACKGROUND = 0x202020
const CARD_BACKGROUND_HEX = '#202020'
let nestFrame = 0
// 그림이 보일 때만 돈다. 패널이 닫히거나 입력창 위로 옮겨 칠할 곳이 없으면 멈춘다
let nestTimer: ReturnType<EngineInterface['clock']['every']> | null = null
// 그린 직후에는 Raster 가 아직 화면에 붙지 않아 칠하기를 거절할 수 있어, 몇 번 거절이 이어질 때만 멈춘다
let nestDenied = 0
const NEST_DENY_LIMIT = 8

function base64Of(cells: Uint32Array): string {
  // 엔진의 Uint8Array 는 toBase64 를 갖지만 TypeScript 의 lib 에는 아직 없다
  const bytes = new Uint8Array(cells.buffer) as Uint8Array & { toBase64(): string }
  return bytes.toBase64()
}

function nestCells(scene: { columns: number; input: NestInput }, now: number): string {
  return base64Of(drawNest(scene.input, scene.columns, nestFrame, now, lookupSprite))
}

// 막 진화해 진화 장면을 보이는 중인 포켓몬. 최종 진화형이 되어 맡긴 것이 풀렸어도 장면이 끝날 때까지 풀밭에 선다
function evolvingOf(scene: { input: NestInput }, now: number): BoxEntry | undefined {
  const evolving = scene.input.evolving
  return evolving && now - evolving.at < EVOLVE_MS ? scene.input.box.find(entry => entry.key === evolving.key) : undefined
}

// 키우미집에 맡긴 포켓몬. 풀밭을 걸어다닌다
function walkerOf(scene: { input: NestInput }, now: number): BoxEntry | undefined {
  return evolvingOf(scene, now) ?? scene.input.box.find(entry => entry.key === scene.input.lead)
}

function daycareCells(scene: { columns: number; input: NestInput }, now: number): string {
  const lead = walkerOf(scene, now)
  // 맡긴 포켓몬이 있으면 그림을 아직 못 불러왔어도 풀밭 높이는 미리 맞춘다
  const walker = lead ? (lookupSprite(lead.species, WALKER_SIZE) ?? null) : undefined
  const evolving = evolvingOf(scene, now) && scene.input.evolving
  const before = evolving ? (lookupSprite(evolving.from, WALKER_SIZE) ?? null) : null
  return base64Of(drawDaycareGround(scene.input.daycare, scene.columns, nestFrame, walker, before))
}

// 이번 박스 페이지의 칸. 한 줄을 늘 꽉 채워 그리고, 포켓몬이 없는 칸은 null 이다
function boxTiles(scene: { columns: number; input: NestInput }) {
  const page = boxOnPage(scene.input, scene.columns)
  return Array.from({ length: boxPerRow(scene.columns) }, (_, i) => page[i] ?? null)
}

function tileCells(scene: { columns: number; input: NestInput }, entry: BoxEntry | null, now: number): string {
  const { lead = null, evolving = null } = scene.input
  return base64Of(drawBoxTile(entry, entry !== null && entry.key === lead, evolving, nestFrame, now, lookupSprite))
}

// 마우스 카드의 폭과 칸 기준 왼쪽 위치. 칸 가운데에 두되 패널 밖으로 나가지 않게 당긴다. 칸 줄은 가운데 정렬이다
function cardPlace(columns: number, i: number): { width: number; left: number } {
  const width = Math.min(CARD_COLUMNS, columns)
  const tileX = Math.floor((columns - boxPerRow(columns) * TILE) / 2) + i * TILE
  const centered = Math.floor((TILE - width) / 2)
  // -tileX 는 tileX 가 0 일 때 -0 이 되어 0 - tileX 로 쓴다
  return { width, left: Math.max(0 - tileX, Math.min(centered, columns - width - tileX)) }
}

function startNest($: EngineInterface) {
  nestDenied = 0
  nestTimer ??= $.clock.every(NEST_TICK_MS, () => void tickNest($))
}

function stopNest() {
  nestScene = null
  nestTimer?.cancel()
  nestTimer = null
}

// 박스 페이지를 앞뒤로 넘긴다. 끝에서 넘기면 처음으로 돌아간다
function turnBox($: EngineInterface, delta: number) {
  if (!nestScene) {
    return
  }
  const pages = boxPages(nestScene.input, nestScene.columns)
  boxPage = (boxPageOf(nestScene.input, nestScene.columns) + delta + pages) % pages
  $.ui.invalidate('ui.render')
}

async function tickNest($: EngineInterface) {
  if (!nestScene) {
    stopNest()
    return
  }
  nestFrame += 1
  const now = await $.clock.now()
  // 진화 장면이 끝나 풀밭에 설 포켓몬이 사라지면 풀밭 높이가 바뀌므로 칠하지 않고 다시 그린다
  if (!daycareCollapsed && daycareGroundRows(walkerOf(nestScene, now) !== undefined) !== daycareRowsDrawn) {
    $.ui.invalidate('ui.render')
    return
  }
  // 알 줄이 있으면 알 그림을, 키우미집을 펼쳤으면 풀밭을 칠한다. 칠할 것이 없으면 거절도 세지 않는다
  const painted = [
    nestScene.rows > 0 ? await $.ui.blit({ requestId: PANE, key: 'nest', cells: nestCells(nestScene, now) }) : null,
    daycareCollapsed ? null : await $.ui.blit({ requestId: PANE, key: 'daycare', cells: daycareCells(nestScene, now) }),
  ].filter(one => one !== null)
  // 전설 등장 장면을 한 걸음씩 칠하고, 끝나면 장면을 걷어 내게 다시 그린다
  if (arrivalShown) {
    if (arrivalStep(now) === null) {
      arrivalShown = null
      $.ui.invalidate('ui.render')
    } else {
      await $.ui.blit({ requestId: PANE, key: 'arrival', cells: arrivalCells(nestScene.columns, now) })
    }
  }
  // 막 진화한 박스 칸만 깜빡이므로 그 칸만 다시 칠한다
  const evolving = nestScene.input.evolving
  if (evolving && now - evolving.at < EVOLVE_MS && !boxCollapsed) {
    const tiles = boxTiles(nestScene)
    const at = tiles.findIndex(entry => entry?.key === evolving.key)
    if (at >= 0) {
      await $.ui.blit({ requestId: PANE, key: `tile-${at}`, cells: tileCells(nestScene, tiles[at]!, now) })
    }
  }
  nestDenied = painted.some(one => one.deny) ? nestDenied + 1 : 0
  if (nestDenied >= NEST_DENY_LIMIT) {
    stopNest()
  }
}

// Linear 알림

// 세션이 여럿 떠 있어도 Linear 는 한 세션만 부르고 토스트도 그 세션만 띄우게, 조회 결과를 이 파일에 같이 쓴다
const INBOX_FILE = '.claude/mod-inbox.json'
// 파일만 읽는 주기. Linear 는 파일이 INBOX_TTL_MS 보다 오래됐을 때만 부른다
const INBOX_CHECK_MS = 60 * 1000
// 조회를 맡겠다고 쓴 뒤 다른 세션이 같은 순간에 덮어썼는지 보려고 잠깐 기다린다
const LEASE_SETTLE_MS = 300
// 패널에 보이는 최대 개수
const INBOX_SHOWN = 20

const inbox = atom({ plugin: 'mod-hud', key: 'inbox' } as const, { items: [], fetchedAt: null, isOk: false })

let isInboxRefreshing = false

async function readInboxCache($: EngineInterface, path: string): Promise<InboxCache> {
  try {
    return parseCache(await $.fs.read(path))
  } catch {
    return emptyCache()
  }
}

async function fetchNotifications($: EngineInterface): Promise<InboxItem[] | null> {
  try {
    // 멘션과 답글만 남기고 거르므로, GitLab 알림이 쌓여도 그것들이 밀려나지 않게 한 번에 최대치를 받는다
    const result = await $.mcp.call('claude.ai Linear', 'get_notifications', { unreadOnly: true, limit: 250 })
    const text = result.content.find(block => block.type === 'text')?.text
    const parsed = result.isError || !text ? null : parseNotifications(text, await $.clock.now())
    return parsed && onlyForMe(parsed)
  } catch {
    // Linear 연결이 없으면 섹션을 비운다
    return null
  }
}

async function refreshInbox($: EngineInterface, isForced: boolean) {
  if (isInboxRefreshing) {
    return
  }
  isInboxRefreshing = true
  try {
    const home = await $.env.get('HOME')
    if (!home) {
      return
    }
    const path = `${home}/${INBOX_FILE}`
    const me = await $.session.id()
    let cache = await readInboxCache($, path)

    if (shouldFetch(cache, await $.clock.now(), me, isForced)) {
      // 파일에 이 세션이 맡는다고 써 두고, 잠깐 뒤 다시 읽어 그대로일 때만 부른다. 나중에 쓴 세션이 맡는다
      await $.fs.write(path, JSON.stringify({ ...cache, lease: { by: me, at: await $.clock.now() } }))
      await $.clock.sleep(LEASE_SETTLE_MS)
      const claimed = await readInboxCache($, path)
      if (claimed.lease?.by === me) {
        const fetched = await fetchNotifications($)
        const applied = applyFetch(claimed, fetched, await $.clock.now())
        await $.fs.write(path, JSON.stringify(applied.cache))
        cache = applied.cache
        if (applied.fresh.length > 0) {
          $.ui.toast(toastText(applied.fresh))
        }
      } else {
        cache = claimed
      }
    }

    const isOk = cache.okAt !== null && cache.okAt === cache.fetchedAt
    await update($, inbox, () => ({
      items: isOk ? sortInbox(cache.notifications) : [],
      fetchedAt: cache.fetchedAt,
      isOk,
    }))
  } catch {
    // 알림을 못 읽어도 다른 패널 동작은 막지 않는다
  } finally {
    isInboxRefreshing = false
  }
}

async function isPaneUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function refreshAll($: EngineInterface) {
  await Promise.all([refreshSessions($), refreshIssues($, true), refreshInbox($, true)])
}

export const register: Register = (on, options) => {
  config.gitlabUrl = typeof options.gitlabUrl === 'string' ? options.gitlabUrl : ''
  config.baseBranch = typeof options.baseBranch === 'string' ? options.baseBranch : ''
  config.autoCleanup = options.autoCleanup === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mod-hud',
      description: 'Open or close the session and issue panel. Add dashboard to take this session out of the Pokémon eggs, or put it back',
    })
    await writeStatus($, { state: 'waiting' })
    $.clock.every(HEARTBEAT_MS, () => void heartbeat($))
    // 입력창 위 한 줄은 늘 보이므로 패널이 닫혀 있어도 읽는다
    $.clock.every(SESSIONS_REFRESH_MS, () => {
      void refreshSessions($)
    })
    // 머지된 worktree 정리도 여기서 돌므로 패널과 상관없이 갱신한다
    if (await ensureRepo($)) {
      $.clock.every(ISSUES_CHECK_MS, () => void refreshIssues($, false))
      void refreshIssues($, false)
    }
    // 파일이 15분 안이면 파일만 읽고, 아니면 한 세션만 Linear 를 부른다. MCP 를 기다리느라 시작을 붙잡지 않는다
    $.clock.every(INBOX_CHECK_MS, () => void refreshInbox($, false))
    void refreshInbox($, false)
    // 상태 파일만 읽고 git 은 돌리지 않으니 시작을 오래 붙잡지 않는다
    await refreshSessions($)

    return next(e)
  })

  on('command.run', { command: 'mod-hud' }, async ($, e) => {
    if (e.args.trim() === 'dashboard') {
      const isDashboard = !mine?.isDashboard
      await writeStatus($, { isDashboard })
      void refreshSessions($)
      return {
        text: isDashboard
          ? 'Marked this session as a dashboard. It gets no Pokémon egg.'
          : 'Unmarked this session as a dashboard. It gets eggs again.',
      }
    }
    if (await isPaneUp($)) {
      await $.ui.close({ id: PANE })
      return { text: 'Closed the panel.' }
    }
    await $.ui.open({ id: PANE, title: 'Mod HUD' })
    void refreshAll($)
    return { text: 'Opened the panel.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // <task-notification> 처럼 시스템이 넣은 입력은 내 요청이 아니므로 이전 요청을 남긴다
    const prompt = e.text.trimStart().startsWith('<') ? null : firstLine(e.text)
    const now = await $.clock.now()
    const background = pendingTasks(await backgroundTasks($), now, finishedTaskIds(e.text))
    const base = { state: 'working' as const, attention: null, workingSince: now, background, waitingOnTasks: false }
    // 리뷰 세션은 이어서 다른 요청을 받아도 리뷰 세션이므로 표시를 남긴다
    const review = isCodeReviewPrompt(prompt) ? { isCodeReview: true } : {}
    await writeStatus($, prompt ? { ...base, ...review, prompt } : base)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // 서브에이전트의 턴이 끝나도 메인 세션은 아직 일하는 중이다
    if (e.agentId === undefined) {
      await writeStatus($, { state: 'waiting', title: await readTitle($), waitingOnTasks: false })
      const now = await $.clock.now()
      const attention = attentionAfterTurn(e.answer, e.isAborted, now)
      // 백그라운드 작업(push, 서브에이전트 등)이 남았으면 그 알림에 세션이 다시 깨어나므로 아직 진행 중이다
      // classic.Stop 의 background_tasks 는 mod 에 오지 않아(2026-10-13 확인) 띄운 작업을 직접 센다
      const isWaitingTask = (await settleBackground($, now, true)).length > 0
      await (isWaitingTask && attention?.kind === 'answered' ? keepWorking($) : setAttention($, attention))
    }
    return done
  })

  // 권한 승인 창이 뜨면 작업 중이어도 내 차례로 올린다
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') {
      await setAttention($, { kind: 'permission', since: await $.clock.now(), text: firstLine(e.message) })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // 승인이 끝나 도구가 돌고 나면 다시 진행 중으로 돌린다
  // 백그라운드로 띄운 Bash·Agent 도 여기서 기억해 둔다. 끝났다는 <task-notification> 이 오면 prompt.submit 에서 지운다
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (mine?.attention?.kind === 'permission') {
      await writeStatus($, { attention: null })
    }
    const id = launchedTaskId(ran.result)
    if (id) {
      const background = await backgroundTasks($)
      await writeStatus($, { background: [...background, { id, at: await $.clock.now() }] })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const id = e.task_id ?? e.shell_id
    if (id && ran.deny === undefined) {
      const background = await backgroundTasks($)
      await writeStatus($, { background: background.filter(task => task.id !== id) })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const question = e.questions[0]?.question ?? ''
    await setAttention($, { kind: 'question', since: await $.clock.now(), text: firstLine(question) })
    const ran = await next(e)
    await writeStatus($, { attention: null })
    return ran
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await writeStatus($, { state: 'ended', endReason: e.reason })
    if (e.reason === 'clear' || e.reason === 'resume') {
      handoff = { id: e.sessionId, isDashboard: mine?.isDashboard === true }
    }
    // /clear 는 새 id 로 이어지고 session.start 가 다시 오지 않아, 새 세션을 처음부터 쓰게 비운다
    if (e.reason === 'clear') {
      mine = null
    }
    return next(e)
  })

  // /clear 뒤 새 세션에는 이 이벤트만 오므로, 새로고침 주기를 기다리지 않고 바로 다시 채운다
  on('classic.SessionStart', async ($, e, next) => {
    transcriptPath = e.transcript_path || null
    // 이어 연 세션은 이미 이름이 있다. 끝난 세션은 writeStatus 가 이어 받는다
    if (e.source === 'resume') {
      await writeStatus($, { title: await readTitle($) })
    }
    if (e.source === 'clear') {
      mine = null
      await writeStatus($, { state: 'waiting' })
      // 상태 파일만 읽고 git 은 돌리지 않아 /clear 를 오래 붙잡지 않는다
      await refreshSessions($)
      if (await ensureRepo($)) {
        void refreshIssues($, false)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // typecheck, test 같은 검사 결과를 이 세션 상태에 남긴다
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const name = findCheck(e.command)
    if (name === null || e.run_in_background || !(await ensureRepo($))) {
      return next(e)
    }
    const ran = await next(e)
    if (ran.deny === undefined) {
      await writeStatus($, { check: { name, isOk: !ran.isError, at: await $.clock.now() } })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    // next 의 결과는 도구별로 좁혀지지 않아 이 도구의 결과 타입으로 읽는다
    const result = ran.result as BuiltinToolResults['TodoWrite'] | undefined
    const list = result?.newTodos ?? (ran.deny === undefined && !ran.isError ? e.todos : null)
    if (list) {
      await setTodos(
        $,
        list.map((todo, index) => ({
          id: String(index),
          label: todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content,
          status: todo.status,
        })),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as BuiltinToolResults['TaskCreate'] | undefined)?.task
    if (task) {
      await setTodos($, [...currentTodos(), { id: task.id, label: task.subject, status: 'pending' }])
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if ((ran.result as BuiltinToolResults['TaskUpdate'] | undefined)?.success) {
      await setTodos($, applyTaskUpdate(currentTodos(), e.taskId, { status: e.status, label: e.subject }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const sessions = await read($, board)
    const mrs = (await read($, rows)).filter(row => row.mr?.action)
    const unread = (await read($, inbox)).items.length
    const parts = [
      { key: 'mine', count: sessions.mine.length, text: `${ICON.mine} Your turn`, color: COLOR.mine },
      { key: 'running', count: sessions.running.length, text: `${ICON.running} Working`, color: COLOR.running },
      { key: 'mr', count: mrs.length, text: `${ICON.mr} MR`, color: COLOR.mr },
      { key: 'inbox', count: unread, text: `${ICON.inbox} Linear`, color: COLOR.inbox },
    ].filter(part => part.count > 0)
    if (e.props.hasSurvey || parts.length === 0) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const mrOf = await read($, branchMrs)
    return (
      <Box flexDirection="column">
        <Box>
          {parts.map((part, index) => (
            <Text key={part.key} color={part.color} bold={part.key === 'mine'}>
              {index > 0 ? '   ' : ''}
              {part.text} {part.count}
            </Text>
          ))}
        </Box>
        {sessions.mine.slice(0, BAND_SHOWN).map(entry => {
          const kind = entry.attention?.kind ?? 'answered'
          const detail = kind === 'answered' ? entry.prompt : (entry.attention?.text ?? entry.prompt)
          const mr = entry.branch ? mrOf[entry.branch] : undefined
          // 줄 전체를 Text 하나로 그려야 넘칠 때 줄을 바꾸지 않고 끝이 잘린다. 제목이 있으면 브랜치는 뺀다
          return (
            <Box key={entry.id}>
              <Box flexShrink={1}>
                <Text wrap="truncate-end">
                  <Text color={ATTENTION[kind].color}>
                    {'  '}
                    {ATTENTION[kind].mark} {ATTENTION[kind].label}
                  </Text>
                  <Text bold> {entry.title ?? entry.label}</Text>
                  <Text dimColor> {formatFor(now - entry.since)}</Text>
                  {detail && <Text dimColor>  › {firstLine(detail)}</Text>}
                </Text>
              </Box>
              {mr && (
                <Box flexShrink={0}>
                  <Button plain key={`session-mr-${entry.id}`} onPress={() => openUrl($, mr.url)}>
                    <Text color={COLOR.mr}> !{mr.iid}</Text>
                  </Button>
                </Box>
              )}
            </Box>
          )
        })}
        {sessions.mine.length > BAND_SHOWN && <Text dimColor>  and {sessions.mine.length - BAND_SHOWN} more, /mod-hud opens the panel</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // Raster 는 터미널만 그린다
    const Raster = 'Raster' in elements ? elements.Raster : null
    const issueRows = await read($, rows)
    const mrOf = await read($, branchMrs)
    // 세션 한 줄. 줄 전체를 Text 하나로 그려야 패널 폭을 넘을 때 빈 줄로 접히지 않고 끝이 잘린다
    // 잘려도 보이게 시간 같은 tail 을 브랜치보다 앞에 두고, MR 은 따로 떼어 늘 보이게 한다
    const sessionRow = (entry: BoardEntry, head: RenderElement, tail: RenderElement) => {
      const mr = entry.branch ? mrOf[entry.branch] : undefined
      return (
        <Box>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              {head}
              <Text bold>{entry.title ?? entry.label}</Text>
              {tail}
              {entry.title && <Text dimColor> {entry.label}</Text>}
            </Text>
          </Box>
          {mr && (
            <Box flexShrink={0}>
              <Button plain key={`session-mr-${entry.id}`} onPress={() => openUrl($, mr.url)}>
                <Text color={COLOR.mr}> !{mr.iid}</Text>
              </Button>
            </Box>
          )}
        </Box>
      )
    }
    const issues = await read($, issuesMeta)
    const sessions = await read($, board)
    const meta = await read($, sessionsMeta)
    const repo = await ensureRepo($)
    const notes = await read($, inbox)
    const now = await $.clock.now()
    const mrs = issueRows.filter(row => row.mr?.action)
    const hidden = [
      sessions.hidden.stale > 0 ? `unresponsive ${sessions.hidden.stale}` : null,
      sessions.hidden.ended > 0 ? `ended ${sessions.hidden.ended}` : null,
    ].filter(Boolean)

    const heading = (key: keyof typeof ICON, title: string, count?: number) => (
      <Text bold color={COLOR[key]}>
        {ICON[key]} {title}
        {count !== undefined ? ` ${count}` : ''}
      </Text>
    )

    // 알과 박스는 옆에 붙은 패널에만 그린다. 입력창 위에 뜬 패널은 높이를 아껴야 한다
    const hasNest = Raster !== null && e.props.placement === 'dock' && e.props.bodyColumns >= 20
    if (hasNest) {
      const dex = await read($, pokedex)
      // 새 진화를 처음 보면 그 칸이 있는 페이지로 넘긴다
      const columns = e.props.bodyColumns
      const home = (await $.env.get('HOME')) ?? ''
      if (dex.evolving && dex.evolving.at !== evolvingSeen && now - dex.evolving.at < EVOLVING_FRESH_MS) {
        evolvingSeen = dex.evolving.at
        evolvingSeenAt = now
        boxPage = boxPageOfKey({ eggs: [], daycare: [], box: dex.box, boxPage }, columns, dex.evolving.key)
      }
      const evolving = dex.evolving && dex.evolving.at === evolvingSeen ? { ...dex.evolving, at: evolvingSeenAt } : null
      // 막 온 전설을 처음 보면 이 세션의 시각부터 등장 장면을 센다
      if (dex.arrival && dex.arrival.at !== arrivalSeen && now - dex.arrival.at < EVOLVING_FRESH_MS) {
        arrivalSeen = dex.arrival.at
        arrivalShown = { species: dex.arrival.species, at: now, name: await shownName($, home, dex.arrival.species) }
        void loadSprite($, dex.arrival.species)
      }
      const input = { eggs: await read($, eggs), daycare: dex.daycare, box: dex.box, boxPage, lead: dex.lead, evolving }
      nestScene = { columns, rows: nestRows(input, columns), input }
      const lead = dex.box.find(entry => entry.key === dex.lead)
      boxHeader = {
        count: dex.box.length,
        // 최종 진화형은 더 진화하지 않아 경험치 대신 MAX 로 보인다
        lead: lead
          ? `★ ${await shownName($, home, lead.species)} ${canEvolve(lead.species) ? `${xpBar(dex.xp)} ${xpLeft(dex.xp)}` : 'MAX'}`
          : null,
      }
      boxCards = new Map()
      for (const entry of boxOnPage(input, columns)) {
        // 다음 진화는 진화할 때까지 보이지 않는다
        boxCards.set(entry.key, {
          name: await shownName($, home, entry.species),
          caught: localDay(entry.at),
          canLead: canEvolve(entry.species) && entry.key !== dex.lead,
        })
      }
      const walking = dex.box.find(entry => entry.key === dex.lead)
      const walkers = [...(walking ? [walking.species] : []), ...(evolving ? [evolving.from] : [])]
      for (const species of [...speciesToLoad(input, e.props.bodyColumns), ...walkers]) {
        void loadSprite($, species)
      }
      startNest($)
    } else {
      nestScene = null
    }

    return (
      <Box flexDirection="column" justifyContent="space-between" minHeight={hasNest ? e.props.scroll.bodyRows : undefined}>
        <Box flexDirection="column">
          {/* 세션 목록은 30초마다 읽어 늘 최신이라, 묵을 수 있는 GitLab 과 Linear 조회 시각만 보인다 */}
          <Box flexDirection="column">
            {repo?.api && (
              <Text dimColor>
                {ICON.mr} GitLab {issues.isRefreshing ? 'fetching' : freshness(issues.refreshedAt, ISSUES_TTL_MS, now)}
              </Text>
            )}
            {/* Linear 를 연결하지 않았으면 조회 시각도 보이지 않는다 */}
            {notes.isOk && (
              <Text dimColor>
                {ICON.inbox} Linear {freshness(notes.fetchedAt, INBOX_TTL_MS, now)}
              </Text>
            )}
            <Button key="refresh" label="Refresh now" onPress={() => refreshAll($)} />
          </Box>

          {notes.isOk && (
            <Box flexDirection="column" marginTop={1}>
              {/* 안 읽은 게 없으면 문구 대신 (-) 로 비었음을 보인다 */}
              {heading('inbox', `Linear Inbox (${notes.items.length || '-'})`)}
              {notes.items.slice(0, INBOX_SHOWN).map(item => (
                <Box key={item.id} flexDirection="column">
                  {/* 제목이 길면 제목 끝을 자르고, 시각은 칸을 고정해 세로로 꺾이지 않게 한다 */}
                  <Box>
                    <Text>  </Text>
                    <Box flexShrink={1}>
                      <Button plain key={`inbox-${item.id}`} onPress={() => openUrl($, item.url)}>
                        <Text wrap="truncate-end">
                          <Text bold>{item.issue ?? categoryLabel(item)}</Text>
                          <Text> {item.title}</Text>
                        </Text>
                      </Button>
                    </Box>
                    <Box flexShrink={0}>
                      <Text dimColor> {formatAgoShort(now - item.createdAt)}</Text>
                    </Box>
                  </Box>
                  {item.subtitle && (
                    <Text dimColor wrap="truncate-end">
                      {'    '}› {item.subtitle}
                    </Text>
                  )}
                </Box>
              ))}
              {notes.items.length > INBOX_SHOWN && <Text dimColor>  and {notes.items.length - INBOX_SHOWN} more</Text>}
            </Box>
          )}

          <Box flexDirection="column" marginTop={1}>
            {heading('mine', 'Your turn', sessions.mine.length)}
            {sessions.mine.length === 0 && <Text dimColor>  No session is waiting on you</Text>}
            {sessions.mine.map(entry => {
              const kind = entry.attention?.kind ?? 'answered'
              const detail = kind === 'answered' ? entry.prompt : (entry.attention?.text ?? entry.prompt)
              return (
                <Box key={entry.id} flexDirection="column">
                  {sessionRow(
                    entry,
                    <Text color={ATTENTION[kind].color}>
                      {'  '}
                      {ATTENTION[kind].mark} {ATTENTION[kind].label}{' '}
                    </Text>,
                    <Text dimColor> {formatFor(now - entry.since)}</Text>,
                  )}
                  {detail && (
                    <Text dimColor wrap="truncate-end">
                      {'    '}› {detail}
                    </Text>
                  )}
                </Box>
              )
            })}
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {heading('running', 'Working', sessions.running.length)}
            {sessions.running.length === 0 && <Text dimColor>  No session is working</Text>}
            {sessions.running.map(entry => (
              <Box key={entry.id} flexDirection="column">
                {sessionRow(
                  entry,
                  <Text>  </Text>,
                  <Text>
                    {entry.todos && (
                      <Text color={COLOR.running}>
                        {' '}
                        {entry.todos.done}/{entry.todos.total}
                      </Text>
                    )}
                    {entry.check && !entry.check.isOk && <Text color="red"> {entry.check.name} failed</Text>}
                    <Text dimColor> {formatFor(now - entry.since)}</Text>
                  </Text>,
                )}
                {(entry.todos?.current ?? entry.prompt) && (
                  <Text dimColor wrap="truncate-end">
                    {'    '}› {entry.todos?.current ?? entry.prompt}
                  </Text>
                )}
              </Box>
            ))}
          </Box>

          {mrs.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {heading('mr', 'MR', mrs.length)}
              {mrs.map(row => (
                <Box key={row.path}>
                  <Text>  </Text>
                  <Button plain key={`mr-${row.path}`} onPress={() => openUrl($, row.mr?.url)}>
                    <Text bold color={COLOR.mr}>
                      !{row.mr?.iid}
                    </Text>
                    {/* 머지 가능한 MR 은 Worktree 섹션과 같은 말로 상태만 적는다 */}
                    <Text color={row.mr?.action === 'conflict' ? 'red' : COLOR.mr}>
                      {' '}
                      {row.mr?.action === 'conflict' ? 'conflict, needs rebase' : 'opened'}
                    </Text>
                    <Text bold> {row.branch ?? row.issue ?? ''}</Text>
                  </Button>
                </Box>
              ))}
            </Box>
          )}

          {repo && (
            <Box flexDirection="column" marginTop={1}>
              {heading('issues', 'Worktree')}
              {issueRows.map(row => (
                <Box key={row.path} flexDirection="column">
                  <Box>
                    <Text bold>  {row.issue ? `#${row.issue}` : (row.branch ?? 'detached')}</Text>
                    {row.isMain && <Text dimColor> (main)</Text>}
                    {row.linear && <Text color={COLOR.inbox}> {row.linear}</Text>}
                  </Box>
                  {/* 둘째 줄은 브랜치와 커밋 수, 그 옆에 MR. 이슈가 없으면 첫 줄이 이미 브랜치라 커밋 수만 적는다 */}
                  <Box>
                    <Text dimColor wrap="truncate-end">
                      {'    '}
                      {row.issue && row.branch ? `${row.branch}  ` : ''}
                      {row.ahead} commits{row.dirty > 0 ? `, ${row.dirty} changed` : ''}
                    </Text>
                    {row.mr && <Text> </Text>}
                    {row.mr && (
                      <Button plain key={`issue-mr-${row.path}`} onPress={() => openUrl($, row.mr?.url)}>
                        <Text color={row.mr.state === 'merged' ? 'green' : row.mr.state === 'opened' ? COLOR.mr : 'gray'}>
                          !{row.mr.iid} {row.mr.state}
                        </Text>
                      </Button>
                    )}
                  </Box>
                  {row.note && <Text color="yellow">    {row.note}</Text>}
                </Box>
              ))}
              {issues.log.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                  {issues.log.map(line => (
                    <Text dimColor>  {line}</Text>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {sessions.idle.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor bold>
                ○ Idle {sessions.idle.length}
              </Text>
              {/* 제목과 어디서 열어 둔 것인지를 두 줄로 나눈다. 줄마다 넘치면 끝을 자른다 */}
              {sessions.idle.map(entry => (
                <Box key={entry.id} flexDirection="column">
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {entry.title ?? entry.label}
                    {!entry.title && ` ${formatFor(now - entry.since)}`}
                  </Text>
                  {entry.title && (
                    <Text dimColor wrap="truncate-end">
                      {'    '}
                      {entry.label} {formatFor(now - entry.since)}
                    </Text>
                  )}
                </Box>
              ))}
            </Box>
          )}

          {hidden.length > 0 && (
            <Box marginTop={1}>
              <Text dimColor>Hidden: {hidden.join(', ')}</Text>
            </Box>
          )}
        </Box>
        {/* 남는 높이를 띄워 알과 박스를 패널 바닥에 붙인다. 내용이 길면 내용 바로 아래에 온다 */}
        {nestScene && Raster && (
          <Box marginTop={1} flexDirection="column">
            {/* 부화한 포켓몬은 세션을 닫지 않아도 박스로 보낼 수 있다 */}
            {eggsOnScreen(nestScene.input, nestScene.columns)
              .filter(egg => egg.stage === 'hatched')
              .map(egg => (
                <Button key={`send-${egg.key}`} label={`Send to PC BOX · ${egg.label}`} onPress={() => sendToBox($, egg.key)} />
              ))}
            {arrivalStep(now) !== null && (
              // 막 온 전설의 등장 장면을 알과 DAY CARE 위에 겹쳐 띄운다. 다른 줄을 밀어내지 않는다
              <Box position="absolute" top={0} width={nestScene.columns} justifyContent="center">
                <Raster
                  key="arrival"
                  columns={Math.min(nestScene.columns, ARRIVAL_COLUMNS)}
                  rows={ARRIVAL_ROWS}
                  cells={arrivalCells(nestScene.columns, now)}
                />
              </Box>
            )}
            {nestScene.rows > 0 && (
              <Raster key="nest" columns={nestScene.columns} rows={nestScene.rows} cells={nestCells(nestScene, now)} />
            )}
            <Box backgroundColor="#c8782a" width={nestScene.columns} paddingX={1}>
              {/* 머리줄을 누르면 키우미집 풀밭을 접거나 편다 */}
              <Button
                plain
                key="daycare-toggle"
                onPress={() => {
                  daycareCollapsed = !daycareCollapsed
                  $.ui.invalidate('ui.render')
                }}
              >
                <Text bold color="#ffffff">
                  {daycareCollapsed ? '▸' : '▾'} DAY CARE
                </Text>
                {/* 키우미집에 맡긴 포켓몬은 일한 만큼 경험치를 얻는다. 원작의 키우미집처럼 */}
                {boxHeader.lead && <Text color="#ffe080">{`  ${boxHeader.lead}`}</Text>}
              </Button>
              <Box flexGrow={1} />
              <Text bold color="#ffe080">
                {nestScene.input.daycare.length}
              </Text>
            </Box>
            {!daycareCollapsed && (
              <Raster
                key="daycare"
                columns={nestScene.columns}
                rows={(daycareRowsDrawn = daycareGroundRows(walkerOf(nestScene, now) !== undefined))}
                cells={daycareCells(nestScene, now)}
              />
            )}
            <Box backgroundColor="#3a6ea5" width={nestScene.columns} paddingX={1} marginTop={1}>
              {/* 머리줄을 누르면 박스를 접거나 편다 */}
              <Button
                plain
                key="box-toggle"
                onPress={() => {
                  boxCollapsed = !boxCollapsed
                  $.ui.invalidate('ui.render')
                }}
              >
                <Text bold color="#ffffff">
                  {boxCollapsed ? '▸' : '▾'} PC BOX
                  {!boxCollapsed &&
                    boxPages(nestScene.input, nestScene.columns) > 1 &&
                    `  ${boxPageOf(nestScene.input, nestScene.columns) + 1}/${boxPages(nestScene.input, nestScene.columns)}`}
                </Text>
              </Button>
              <Box flexGrow={1} />
              <Text bold color="#ffe080">
                {boxHeader.count}
              </Text>
            </Box>
            {!boxCollapsed && (
              <Box justifyContent="center">
                {boxTiles(nestScene).map((entry, i) => (
                  <Box key={`tile-${i}`}>
                    <Raster key={`tile-${i}`} columns={TILE} rows={TILE_ROWS} cells={tileCells(nestScene!, entry, now)} />
                    {entry && boxCards.has(entry.key) && (
                      // 마우스를 올린 칸 위로 원본 크기 카드를 띄운다. 다른 줄을 밀어내지 않게 겹쳐 그린다
                      <Box
                        position="absolute"
                        bottom={TILE_ROWS}
                        left={cardPlace(nestScene!.columns, i).left}
                        width={cardPlace(nestScene!.columns, i).width}
                        display="none"
                        hover={{ display: 'flex' }}
                        flexDirection="column"
                        alignItems="center"
                        borderStyle="round"
                        backgroundColor={CARD_BACKGROUND_HEX}
                      >
                        {(() => {
                          const portrait = drawPortrait(entry.species, lookupSprite, CARD_BACKGROUND)
                          return (
                            portrait && (
                              <Raster key={`portrait-${i}`} columns={portrait.columns} rows={portrait.rows} cells={base64Of(portrait.cells)} />
                            )
                          )
                        })()}
                        <Text bold>{boxCards.get(entry.key)!.name}</Text>
                        <Text dimColor>caught {boxCards.get(entry.key)!.caught}</Text>
                        {entry.key === nestScene!.input.lead && <Text color="#ffe080">{boxHeader.lead}</Text>}
                        {boxCards.get(entry.key)!.canLead && (
                          <Box justifyContent="center" width="100%">
                            <Button key={`lead-${entry.key}`} label="Leave at DAY CARE" onPress={() => pickLead($, entry.key)} />
                          </Box>
                        )}
                        {entry.key === nestScene!.input.lead && (
                          <Box justifyContent="center" width="100%">
                            <Button key={`takeback-${entry.key}`} label="Take back" onPress={() => pickLead($, TAKE_BACK)} />
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            )}
            {!boxCollapsed && boxPages(nestScene.input, nestScene.columns) > 1 && (
              <Box justifyContent="center">
                <Button key="box-prev" label="◀ Prev" onPress={() => turnBox($, -1)} />
                <Button key="box-next" label="Next ▶" onPress={() => turnBox($, 1)} />
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
