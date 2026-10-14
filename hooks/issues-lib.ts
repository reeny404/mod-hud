import type { IssuesCache, Mr, Row, TreeSession, Tree } from '../types'

// 이 시간 안에 heartbeat 가 없으면 세션이 닫힌 것으로 본다
export const LIVE_MS = 3 * 60 * 1000

// feat/#ABC-611-xxx, bugfix/#RF-92-xxx, feat/#867-xxx, chore/ABC-523-xxx 에서 이슈 번호를 뽑는다
// # 이 없으면 대문자 키만 이슈로 본다. feat/add-login-2 같은 브랜치를 이슈로 잡지 않게 한다
export const parseIssue = (branch: string): string | null =>
  (branch.match(/#([A-Za-z]+-\d+|\d+)/)?.[1] ?? branch.match(/(?:^|[/_])([A-Z][A-Z0-9]*-\d+)(?![A-Za-z0-9])/)?.[1])?.toUpperCase() ??
  null

// origin remote 주소로 GitLab API 의 프로젝트 주소를 만든다. override 는 API 호스트가 remote 와 다를 때(ssh remote 등) 쓴다
// GitHub 은 MR 이 없으므로 null
export const gitlabProjectApi = (remote: string, override = ''): string | null => {
  const url = remote.trim()
  const parsed =
    url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/) ??
    url.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/) ??
    url.match(/^(?:[^@/]+@)?([^/:]+):(.+?)(?:\.git)?\/?$/)
  if (!parsed) {
    return null
  }
  const [, host = '', path = ''] = parsed
  if (/(^|\.)github\.com(:\d+)?$/.test(host)) {
    return null
  }
  const isHttp = /^https?:/.test(url)
  const base = override.trim().replace(/\/+$/, '') || `${isHttp ? url.slice(0, url.indexOf(':')) : 'https'}://${host}`
  return `${base}/api/v4/projects/${encodeURIComponent(path)}`
}

// `git symbolic-ref refs/remotes/origin/HEAD` 출력에서 기본 브랜치 이름을 뽑는다
export const parseDefaultBranch = (symbolicRef: string): string | null =>
  symbolicRef.trim().match(/^refs\/remotes\/origin\/(.+)$/)?.[1] ?? null

// 세션 줄에 MR 을 찾지 않는 브랜치. 기본 브랜치와 배포 브랜치는 MR 의 소스가 아니다
export const isLongLivedBranch = (branch: string, base: string): boolean =>
  branch === base || ['main', 'master', 'develop'].includes(branch) || branch.startsWith('release/')

// 이슈 조회 결과를 저장소마다 따로 둘 파일 이름
export const issuesFileOf = (root: string): string => `mod-issues-${root.replace(/[^a-zA-Z0-9]/g, '-')}.json`

// `git worktree list --porcelain` 출력을 worktree 목록으로 바꾼다. 첫 블록이 메인 worktree 다
export const parseWorktrees = (porcelain: string): Tree[] =>
  porcelain
    .split('\n\n')
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split('\n')
      const field = (name: string) =>
        lines.find(line => line.startsWith(`${name} `))?.slice(name.length + 1) ?? null

      return {
        path: field('worktree') ?? '',
        head: field('HEAD') ?? '',
        branch: field('branch')?.replace(/^refs\/heads\//, '') ?? null,
        isMain: index === 0,
      }
    })
    .filter(tree => tree.path !== '')

export const isLive = (session: TreeSession, now: number): boolean =>
  session.state !== 'ended' && now - session.updatedAt < LIVE_MS

// 메인 worktree 경로가 다른 worktree 경로의 접두어이므로 가장 긴 경로에 붙인다
export const findTreeFor = (trees: Tree[], cwd: string): Tree | null =>
  trees
    .filter(tree => cwd === tree.path || cwd.startsWith(`${tree.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null

export const assignSessions = (
  trees: Tree[],
  sessions: TreeSession[],
  now: number,
): Map<string, TreeSession> => {
  const byTree = new Map<string, TreeSession>()
  for (const session of sessions) {
    if (!isLive(session, now)) {
      continue
    }
    const tree = findTreeFor(trees, session.cwd)
    const prev = tree ? byTree.get(tree.path) : undefined
    if (tree && (!prev || prev.updatedAt < session.updatedAt)) {
      byTree.set(tree.path, session)
    }
  }
  return byTree
}

// 머지된 worktree 에서 이만큼 넘게 입력을 기다린 세션은 정리를 막지 않는다
export const IDLE_CLEANUP_MS = 24 * 60 * 60 * 1000

export const isIdle = (session: TreeSession, now: number): boolean =>
  session.state === 'waiting' && session.waitingSince !== undefined && now - session.waitingSince >= IDLE_CLEANUP_MS

// 머지된 MR 의 worktree 를 지워도 되는지 본다. 못 지우면 그 이유를 돌려준다
// sessions 는 모든 세션의 상태 파일. 한 worktree 에 세션이 여럿이면 모두 오래 대기 중이어야 지운다
export const cleanupBlocker = (row: Row, sessions: readonly TreeSession[], ownCwd: string, now: number): string | null => {
  if (row.isMain || row.mr?.state !== 'merged') {
    return 'not-merged'
  }
  const here = sessions.filter(session => isLive(session, now) && findTreeFor([row], session.cwd))
  if (here.some(session => !isIdle(session, now))) {
    return 'a session is open here'
  }
  // 이 세션의 상태 파일이 없어 위에서 못 걸렀을 때
  if (here.length === 0 && findTreeFor([row], ownCwd)) {
    return 'this session runs here'
  }
  if (row.dirty > 0) {
    return `${row.dirty} uncommitted changes`
  }
  if (row.head !== row.mr.sha) {
    return 'has commits not in the MR'
  }
  return null
}

type RawMr = { state: string; detailed_merge_status?: string; has_conflicts?: boolean }

// 열린 MR 중 내가 움직여야 하는 것만 고른다. 충돌은 rebase 를, 머지 가능은 머지 버튼을 누를 차례다
export const mrAction = (raw: RawMr): Mr['action'] => {
  if (raw.state !== 'opened') {
    return null
  }
  if (raw.has_conflicts || raw.detailed_merge_status === 'conflict' || raw.detailed_merge_status === 'need_rebase') {
    return 'conflict'
  }
  return raw.detailed_merge_status === 'mergeable' ? 'mergeable' : null
}

const SCRIPTS = ['build', 'build-lib', 'typecheck', 'test', 'test:e2e', 'lint']
// 패키지 스크립트가 아니라 도구 이름 그대로 남기는 검사
const TOOLS = ['vitest', 'jest', 'pytest', 'ruff', 'mypy', 'pyright', 'tsc']

// 상태로 남길 검사를 찾는다. pnpm·npm·yarn 스크립트나 테스트·린트 도구. 없으면 null
export const findCheck = (command: string): string | null => {
  const script = command.match(/\b(?:pnpm|npm|yarn)\s+(?:run\s+)?([\w:-]+)/)?.[1]
  if (script && SCRIPTS.includes(script)) {
    return script
  }
  // 명령을 ;·&&·| 로 나눈 각 조각의 첫 단어를 본다. pnpm exec·uv run·python -m 같은 실행기는 벗긴다
  const runner = /^(?:(?:pnpm|npx|uv|poetry|pipenv|hatch)\s+(?:exec|run)\s+|npx\s+|python3?\s+-m\s+)/
  for (const part of command.split(/[;&|]+/)) {
    const word = part.trim().replace(/^cd\s+\S+\s*/, '').replace(runner, '').split(/\s+/)[0] ?? ''
    if (TOOLS.includes(word)) {
      return word
    }
  }
  return null
}

export const formatAgo = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

// .env.local 에서 GITLAB_TOKEN 값만 꺼낸다
export const readEnvValue = (text: string, name: string): string | null => {
  const line = text.split('\n').find(one => one.trim().startsWith(`${name}=`))
  const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
  return value ? value : null
}

// 이슈 조회 주기. 세션이 몇 개든 이 주기에 한 번만 git 과 GitLab 을 부른다
export const ISSUES_TTL_MS = 2 * 60 * 1000

export const emptyIssuesCache = (): IssuesCache => ({ fetchedAt: null, rows: [], branchMrs: {}, checked: [], log: [], lease: null })

// 깨졌거나 예전 모양인 파일은 빈 값으로 읽는다
export const parseIssuesCache = (text: string): IssuesCache => {
  try {
    const raw = JSON.parse(text) as Partial<IssuesCache> | null
    if (!raw || typeof raw !== 'object') {
      return emptyIssuesCache()
    }
    return {
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
      rows: Array.isArray(raw.rows) ? raw.rows : [],
      branchMrs: raw.branchMrs && typeof raw.branchMrs === 'object' && !Array.isArray(raw.branchMrs) ? raw.branchMrs : {},
      checked: Array.isArray(raw.checked) ? raw.checked.filter(branch => typeof branch === 'string') : [],
      log: Array.isArray(raw.log) ? raw.log.filter(line => typeof line === 'string') : [],
      lease:
        raw.lease && typeof raw.lease.by === 'string' && typeof raw.lease.at === 'number'
          ? { by: raw.lease.by, at: raw.lease.at }
          : null,
    }
  } catch {
    return emptyIssuesCache()
  }
}
