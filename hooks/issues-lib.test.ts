import { expect, test } from 'claude-code/testing'

import type { Row, TreeSession } from '../types'
import {
  assignSessions,
  cleanupBlocker,
  findCheck,
  gitlabProjectApi,
  isGithubRemote,
  isLongLivedBranch,
  issuesFileOf,
  mrAction,
  parseDefaultBranch,
  parseGithubPr,
  parseIssue,
  parseWorktrees,
  readEnvValue,
} from './issues-lib'

const PORCELAIN = `worktree /r/my-app
HEAD aaa
branch refs/heads/feat/#ABC-532-feedback-batch

worktree /r/my-app/.claude/worktrees/wind
HEAD bbb
branch refs/heads/feat/#ABC-611-wind

worktree /r/my-app/.claude/worktrees/tmp
HEAD ccc
detached
`

test('worktree 목록을 읽는다', () => {
  const trees = parseWorktrees(PORCELAIN)
  expect(trees.map(t => [t.path, t.branch, t.isMain])).toEqual([
    ['/r/my-app', 'feat/#ABC-532-feedback-batch', true],
    ['/r/my-app/.claude/worktrees/wind', 'feat/#ABC-611-wind', false],
    ['/r/my-app/.claude/worktrees/tmp', null, false],
  ])
})

test('이슈 번호를 뽑는다', () => {
  expect(parseIssue('feat/#abc-611-wind')).toBe('ABC-611')
  expect(parseIssue('feat/#867-x')).toBe('867')
  expect(parseIssue('claude/elastic-margulis')).toBeNull()
})

test('세션은 가장 긴 경로의 worktree 에 붙고, 오래된 세션은 버린다', () => {
  const trees = parseWorktrees(PORCELAIN)
  const now = 1_000_000
  const sessions: TreeSession[] = [
    { id: 'a', cwd: '/r/my-app/.claude/worktrees/wind/src', state: 'working', updatedAt: now },
    { id: 'b', cwd: '/r/my-app', state: 'waiting', updatedAt: now - 10 * 60 * 1000 },
    { id: 'c', cwd: '/r/my-app/.claude/worktrees/tmp', state: 'ended', updatedAt: now },
  ]
  const byTree = assignSessions(trees, sessions, now)
  expect(byTree.get('/r/my-app/.claude/worktrees/wind')?.id).toBe('a')
  expect(byTree.has('/r/my-app')).toBe(false)
  expect(byTree.has('/r/my-app/.claude/worktrees/tmp')).toBe(false)
})

const merged: Row = {
  path: '/r/my-app/.claude/worktrees/wind',
  head: 'bbb',
  branch: 'feat/#ABC-611-wind',
  isMain: false,
  issue: 'ABC-611',
  ahead: 2,
  dirty: 0,
  session: null,
  mr: { iid: 1, state: 'merged', sha: 'bbb', url: '', action: null },
  linear: null,
  note: null,
}

const DAY = 24 * 60 * 60 * 1000
const NOW = 10 * DAY

test('머지되고 남은 작업이 없으면 정리한다', () => {
  expect(cleanupBlocker(merged, [], '/r/my-app', NOW)).toBeNull()
})

test('정리를 보류하는 경우', () => {
  const live: TreeSession = { id: 'a', cwd: merged.path, state: 'waiting', updatedAt: NOW, waitingSince: NOW - 60_000 }
  expect(cleanupBlocker({ ...merged, mr: { ...merged.mr!, state: 'opened' } }, [], '/x', NOW)).toBe('not-merged')
  expect(cleanupBlocker({ ...merged, isMain: true }, [], '/x', NOW)).toBe('not-merged')
  expect(cleanupBlocker(merged, [live], '/x', NOW)).toBe('a session is open here')
  expect(cleanupBlocker(merged, [{ ...live, state: 'working' }], '/x', NOW)).toBe('a session is open here')
  expect(cleanupBlocker(merged, [], `${merged.path}/src`, NOW)).toBe('this session runs here')
  expect(cleanupBlocker({ ...merged, dirty: 3 }, [], '/x', NOW)).toBe('3 uncommitted changes')
  expect(cleanupBlocker({ ...merged, head: 'zzz' }, [], '/x', NOW)).toBe('has commits not in the MR')
})

test('하루 넘게 입력을 기다린 세션만 있으면 정리한다', () => {
  const idle: TreeSession = { id: 'a', cwd: `${merged.path}/src`, state: 'waiting', updatedAt: NOW, waitingSince: NOW - DAY }
  expect(cleanupBlocker(merged, [idle], `${merged.path}/src`, NOW)).toBeNull()
  // 같은 worktree 에 덜 기다린 세션이 하나라도 있으면 보류한다
  const fresh: TreeSession = { ...idle, id: 'b', waitingSince: NOW - DAY + 60_000 }
  expect(cleanupBlocker(merged, [idle, fresh], '/x', NOW)).toBe('a session is open here')
  // 예전 상태 파일처럼 대기 시작 시각이 없으면 보류한다
  expect(cleanupBlocker(merged, [{ ...idle, waitingSince: undefined }], '/x', NOW)).toBe('a session is open here')
  // 남은 작업 검사는 그대로 한다
  expect(cleanupBlocker({ ...merged, dirty: 1 }, [idle], '/x', NOW)).toBe('1 uncommitted changes')
})

test('검사 명령을 찾는다', () => {
  expect(findCheck('pnpm typecheck 2>&1 | tail')).toBe('typecheck')
  expect(findCheck('pnpm exec vitest run a.test.ts')).toBe('vitest')
  expect(findCheck('pnpm dev')).toBeNull()
})

test('env 값을 읽는다', () => {
  expect(readEnvValue('A=1\nGITLAB_TOKEN="abc"\n', 'GITLAB_TOKEN')).toBe('abc')
  expect(readEnvValue('A=1\n', 'GITLAB_TOKEN')).toBeNull()
})

test('열린 MR 중 머지 가능과 충돌만 내 할 일로 본다', () => {
  expect(mrAction({ state: 'opened', detailed_merge_status: 'mergeable' })).toBe('mergeable')
  expect(mrAction({ state: 'opened', detailed_merge_status: 'conflict' })).toBe('conflict')
  expect(mrAction({ state: 'opened', detailed_merge_status: 'need_rebase' })).toBe('conflict')
  expect(mrAction({ state: 'opened', has_conflicts: true, detailed_merge_status: 'ci_still_running' })).toBe('conflict')
  expect(mrAction({ state: 'opened', detailed_merge_status: 'not_approved' })).toBeNull()
  expect(mrAction({ state: 'merged', detailed_merge_status: 'mergeable' })).toBeNull()
})

test('# 없는 브랜치는 대문자 이슈 키만 이슈로 본다', () => {
  expect(parseIssue('chore/ABC-523-remove-pms-schedule-flag')).toBe('ABC-523')
  expect(parseIssue('PROJ-12_fix')).toBe('PROJ-12')
  expect(parseIssue('feat/add-login-2')).toBeNull()
  expect(parseIssue('feat/v2-api')).toBeNull()
})

test('origin remote 로 GitLab 프로젝트 API 주소를 만든다', () => {
  const ui = 'https://gitlab.example.com:8443/api/v4/projects/acme%2Fdev%2Fteam%2Fapp'
  expect(gitlabProjectApi('https://gitlab.example.com:8443/acme/dev/team/app')).toBe(ui)
  expect(gitlabProjectApi('https://user:tok@gitlab.example.com:8443/acme/dev/team/app.git')).toBe(ui)
  expect(gitlabProjectApi('git@gitlab.example.com:team/api.git')).toBe(
    'https://gitlab.example.com/api/v4/projects/team%2Fapi',
  )
  expect(gitlabProjectApi('ssh://git@gitlab.example.com:2222/team/api.git', 'https://gitlab.example.com:8443/')).toBe(
    'https://gitlab.example.com:8443/api/v4/projects/team%2Fapi',
  )
  expect(gitlabProjectApi('git@github.com:me/repo.git')).toBeNull()
  expect(gitlabProjectApi('https://github.com/me/repo')).toBeNull()
})

test('기본 브랜치와 오래 사는 브랜치를 가린다', () => {
  expect(parseDefaultBranch('refs/remotes/origin/develop\n')).toBe('develop')
  expect(parseDefaultBranch('')).toBeNull()
  expect(isLongLivedBranch('main', 'develop')).toBe(true)
  expect(isLongLivedBranch('release/1.1', 'main')).toBe(true)
  expect(isLongLivedBranch('feat/x', 'main')).toBe(false)
})

test('이슈 조회 파일은 저장소마다 다르다', () => {
  expect(issuesFileOf('/Users/a/my-app')).not.toBe(issuesFileOf('/Users/a/api'))
})

test('파이썬 검사 도구도 검사로 남긴다', () => {
  expect(findCheck('uv run pytest tests/ -q')).toBe('pytest')
  expect(findCheck('python -m pytest')).toBe('pytest')
  expect(findCheck('cd api && poetry run mypy src')).toBe('mypy')
  expect(findCheck('ruff check . | head')).toBe('ruff')
  expect(findCheck('git commit -m "pytest 고침"')).toBeNull()
  expect(findCheck('npm run lint')).toBe('lint')
})

test('GitHub remote 를 알아보고 gh 의 PR 을 MR 과 같은 모양으로 바꾼다', () => {
  expect(isGithubRemote('https://github.com/me/repo.git')).toBe(true)
  expect(isGithubRemote('git@github.com:me/repo.git')).toBe(true)
  expect(isGithubRemote('ssh://git@github.com/me/repo.git')).toBe(true)
  expect(isGithubRemote('https://gitlab.example.com/me/repo')).toBe(false)
  expect(isGithubRemote('https://notgithub.com/me/repo')).toBe(false)
  const pr = (state: string, mergeable = 'UNKNOWN') =>
    JSON.stringify([{ number: 8, state, headRefOid: 'abc', url: 'https://github.com/me/repo/pull/8', mergeable }])
  expect(parseGithubPr(pr('MERGED'))).toEqual({ iid: 8, state: 'merged', sha: 'abc', url: 'https://github.com/me/repo/pull/8', action: null })
  expect(parseGithubPr(pr('OPEN', 'MERGEABLE'))?.state).toBe('opened')
  expect(parseGithubPr(pr('OPEN', 'MERGEABLE'))?.action).toBe('mergeable')
  expect(parseGithubPr(pr('OPEN', 'CONFLICTING'))?.action).toBe('conflict')
  expect(parseGithubPr(pr('CLOSED'))?.state).toBe('closed')
  expect(parseGithubPr('[]')).toBeNull()
  expect(parseGithubPr('not json')).toBeNull()
})
