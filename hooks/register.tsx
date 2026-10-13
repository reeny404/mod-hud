import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Attention, BackgroundTask, BoardEntry, InboxCache, InboxItem, IssuesCache, Mr, Row, SessionStatus, TodoItem } from '../types'
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
import {
  applyTaskUpdate,
  attentionAfterTurn,
  finishedTaskIds,
  firstLine,
  formatFor,
  freshness,
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
  permission: { mark: '!', label: '권한 승인', color: 'red' },
  question: { mark: '?', label: '질문', color: 'yellow' },
  answered: { mark: '✓', label: '확인 대기', color: 'green' },
} as const
const HEARTBEAT_MS = 60 * 1000
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
      ...mine,
      ...patch,
      id,
      cwd,
      root,
      project: projectName(root),
      branch,
      updatedAt,
      waitingSince,
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

// 답은 끝났지만 백그라운드 작업을 기다리는 세션. 확인 대기 대신 진행 중에 둔다
async function keepWorking($: EngineInterface) {
  await writeStatus($, { state: 'working', attention: null })
}

// classic hook 이 알려 준 transcript 경로. mod 가 다시 로드된 직후에는 비어 있어 규칙으로 만든다
let transcriptPath: string | null = null

// /resume 목록에 보이는 이름을 transcript 에서 읽는다. 파일이 커서 이름 줄만 grep 으로 뽑는다
async function readTitle($: EngineInterface): Promise<string | null> {
  try {
    const home = await $.env.get('HOME')
    const path = transcriptPath ?? (home ? transcriptPathOf(home, await $.session.root(), await $.session.id()) : null)
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
    const next = triage(await readSessions($), mine?.id ?? null, now, new Set(merged))
    await update($, board, () => next)
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
    row.note = `정리 실패: ${removed.stderr.trim().split('\n')[0] ?? ''}`
    return null
  }
  // head 가 MR 의 sha 와 같다는 걸 확인했으므로 squash 머지여도 -D 로 지운다
  if (row.branch) {
    await $.process.run(['git', 'branch', '-D', row.branch], { cwd: root })
  }
  const name = row.issue ? `#${row.issue}` : (row.branch ?? row.path)
  // 하루 넘게 대기하던 세션은 지운 폴더에 남으므로 닫으라고 알린다
  const left = row.session ? ', 대기 세션은 닫을 것' : ''
  $.ui.toast(`${name} MR 머지됨, worktree 정리${left}`)
  return `${name}: worktree 와 브랜치를 지웠다${left}`
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
        row.note = `머지됨, 정리 보류: ${blocker}`
      }
    }
    next.push(row)
  }

  // worktree 가 아닌 브랜치에서 일한 세션도 MR 을 찾는다. 세션 줄의 MR 링크와 머지 여부에 쓴다
  const known = new Map(next.map(row => [row.branch, row.mr]))
  const found: Record<string, Mr> = {}
  for (const branch of new Set(allSessions.filter(s => s.state !== 'ended').map(s => s.branch))) {
    if (!branch || isLongLivedBranch(branch, base)) {
      continue
    }
    const mr = known.has(branch) ? known.get(branch) : await findMr(branch)
    if (mr) {
      found[branch] = mr
    }
  }
  return { rows: next, branchMrs: found, log }
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

    if (shouldFetch(cache, await $.clock.now(), me, isForced, ISSUES_TTL_MS)) {
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
  } catch {
    // 이슈를 못 읽어도 다른 패널 동작은 막지 않는다
  } finally {
    isIssuesRefreshing = false
    await update($, issuesMeta, prev => ({ ...prev, isRefreshing: false }))
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
      description: '세션과 이슈 상태 패널을 열거나 닫는다',
    })
    await writeStatus($, { state: 'waiting' })
    $.clock.every(HEARTBEAT_MS, () => void writeStatus($, {}))
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

  on('command.run', { command: 'mod-hud' }, async $ => {
    if (await isPaneUp($)) {
      await $.ui.close({ id: PANE })
      return { text: '패널을 닫았다.' }
    }
    await $.ui.open({ id: PANE, title: 'Mod HUD' })
    void refreshAll($)
    return { text: '패널을 열었다.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // <task-notification> 처럼 시스템이 넣은 입력은 내 요청이 아니므로 이전 요청을 남긴다
    const prompt = e.text.trimStart().startsWith('<') ? null : firstLine(e.text)
    const now = await $.clock.now()
    const background = pendingTasks(await backgroundTasks($), now, finishedTaskIds(e.text))
    const base = { state: 'working' as const, attention: null, workingSince: now, background }
    await writeStatus($, prompt ? { ...base, prompt } : base)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // 서브에이전트의 턴이 끝나도 메인 세션은 아직 일하는 중이다
    if (e.agentId === undefined) {
      await writeStatus($, { state: 'waiting', title: await readTitle($) })
      const now = await $.clock.now()
      const attention = attentionAfterTurn(e.answer, e.isAborted, now)
      // 백그라운드 작업(push, 서브에이전트 등)이 남았으면 그 알림에 세션이 다시 깨어나므로 아직 진행 중이다
      // classic.Stop 의 background_tasks 는 mod 에 오지 않아(2026-10-13 확인) 띄운 작업을 직접 센다
      const isWaitingTask = pendingTasks(await backgroundTasks($), now).length > 0
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
    await writeStatus($, { state: 'ended' })
    // /clear 는 새 id 로 이어지고 session.start 가 다시 오지 않아, 새 세션을 처음부터 쓰게 비운다
    if (e.reason === 'clear') {
      mine = null
    }
    return next(e)
  })

  // /clear 뒤 새 세션에는 이 이벤트만 오므로, 새로고침 주기를 기다리지 않고 바로 다시 채운다
  on('classic.SessionStart', async ($, e, next) => {
    transcriptPath = e.transcript_path || null
    // 이어 연 세션은 이미 이름이 있다
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
      { key: 'mine', count: sessions.mine.length, text: `${ICON.mine} 내 차례`, color: COLOR.mine },
      { key: 'running', count: sessions.running.length, text: `${ICON.running} 진행`, color: COLOR.running },
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
        {sessions.mine.length > BAND_SHOWN && <Text dimColor>  외 {sessions.mine.length - BAND_SHOWN}개, /mod-hud 로 패널 열기</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
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
      sessions.hidden.stale > 0 ? `응답 없음 ${sessions.hidden.stale}` : null,
      sessions.hidden.ended > 0 ? `종료 ${sessions.hidden.ended}` : null,
    ].filter(Boolean)

    const heading = (key: keyof typeof ICON, title: string, count?: number) => (
      <Text bold color={COLOR[key]}>
        {ICON[key]} {title}
        {count !== undefined ? ` ${count}` : ''}
      </Text>
    )

    return (
      <Box flexDirection="column">
        {/* 세션 목록은 30초마다 읽어 늘 최신이라, 묵을 수 있는 GitLab 과 Linear 조회 시각만 보인다 */}
        <Box flexDirection="column">
          {repo?.api && (
            <Text dimColor>
              {ICON.mr} GitLab {issues.isRefreshing ? '조회 중' : freshness(issues.refreshedAt, ISSUES_TTL_MS, now)}
            </Text>
          )}
          {/* Linear 를 연결하지 않았으면 조회 시각도 보이지 않는다 */}
          {notes.isOk && (
            <Text dimColor>
              {ICON.inbox} Linear {freshness(notes.fetchedAt, INBOX_TTL_MS, now)}
            </Text>
          )}
          <Button key="refresh" label="지금 새로고침" onPress={() => refreshAll($)} />
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
            {notes.items.length > INBOX_SHOWN && <Text dimColor>  외 {notes.items.length - INBOX_SHOWN}개</Text>}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          {heading('mine', '내 차례', sessions.mine.length)}
          {sessions.mine.length === 0 && <Text dimColor>  나를 기다리는 세션이 없다</Text>}
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
          {heading('running', '진행 중', sessions.running.length)}
          {sessions.running.length === 0 && <Text dimColor>  일하는 세션이 없다</Text>}
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
                  {entry.check && !entry.check.isOk && <Text color="red"> {entry.check.name} 실패</Text>}
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
                    {row.mr?.action === 'conflict' ? '충돌, rebase 필요' : 'opened'}
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
                    {row.ahead} commits{row.dirty > 0 ? `, 변경 ${row.dirty}` : ''}
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
              ○ 빈 대기 {sessions.idle.length}
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
            <Text dimColor>숨김: {hidden.join(', ')}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
