import type { Attention, BackgroundTask, Board, BoardEntry, Liveness, SessionStatus, TodoItem, TodoSummary } from '../types'
import { parseIssue } from './issues-lib'

// heartbeat 가 1분마다 오므로 3분 넘게 소식이 없으면 CLI 가 꺼진 것으로 본다
export const STALE_MS = 3 * 60 * 1000
// 끝났거나 응답이 없는 세션은 이만큼만 패널에 남긴다
export const KEEP_MS = 60 * 60 * 1000
// 이보다 오래된 상태 파일은 지운다
export const PRUNE_MS = 24 * 60 * 60 * 1000

const PROMPT_MAX = 60

// 요청의 첫 줄만 짧게 남긴다
export const firstLine = (text: string): string | null => {
  const line = text
    .split('\n')
    .map(s => s.trim())
    .find(Boolean)
  if (!line) {
    return null
  }
  return line.length > PROMPT_MAX ? `${line.slice(0, PROMPT_MAX)}…` : line
}

export const projectName = (root: string): string => root.split('/').filter(Boolean).pop() ?? root

export const summarizeTodos = (items: readonly TodoItem[]): TodoSummary | null => {
  if (items.length === 0) {
    return null
  }
  const current = items.find(item => item.status === 'in_progress')
  return {
    done: items.filter(item => item.status === 'completed').length,
    total: items.length,
    current: current?.label ?? null,
  }
}

// TaskCreate·TaskUpdate 는 한 항목씩 오므로 목록을 직접 고쳐 간다
export const applyTaskUpdate = (
  items: readonly TodoItem[],
  id: string,
  patch: { status?: string; label?: string },
): TodoItem[] => {
  if (patch.status === 'deleted') {
    return items.filter(item => item.id !== id)
  }
  return items.map(item =>
    item.id !== id
      ? item
      : {
          ...item,
          label: patch.label ?? item.label,
          status:
            patch.status === 'pending' || patch.status === 'in_progress' || patch.status === 'completed'
              ? patch.status
              : item.status,
        },
  )
}

export const livenessOf = (session: SessionStatus, now: number): Liveness => {
  if (session.state === 'ended') {
    return 'ended'
  }
  return now - session.updatedAt > STALE_MS ? 'stale' : session.state
}

// 마크다운 꾸밈을 벗긴 마지막 줄. 코드 블록 닫는 줄은 건너뛴다
export const lastLine = (text: string): string | null =>
  text
    .split('\n')
    .map(line => line.trim().replace(/^[#>*\-\s]+/, '').replace(/[*_`\s]+$/, ''))
    .filter(line => line !== '' && !line.startsWith('```'))
    .pop() ?? null

export const isQuestion = (text: string): boolean => /[?？]\)?$/.test(lastLine(text) ?? '')

// 메인 턴이 끝난 뒤 세션이 나를 기다리는 이유. 내가 끊은 턴은 내가 보고 있으니 기다리는 것으로 치지 않는다
export const attentionAfterTurn = (answer: string, isAborted: boolean, now: number): Attention | null => {
  if (isAborted) {
    return null
  }
  return isQuestion(answer)
    ? { kind: 'question', since: now, text: firstLine(lastLine(answer) ?? '') }
    : { kind: 'answered', since: now, text: null }
}

// 끝났다는 알림을 놓친 작업이 세션을 진행 중에 묶어 두지 않게, 이만큼 지난 작업은 끝난 것으로 본다
export const BACKGROUND_MAX_MS = 60 * 60 * 1000

// 도구 결과에서 백그라운드로 띄운 작업 id 를 뽑는다. Bash 는 backgroundTaskId, Agent 는 async_launched 의 agentId
export const launchedTaskId = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') {
    return null
  }
  const raw = result as { backgroundTaskId?: unknown; status?: unknown; agentId?: unknown }
  if (typeof raw.backgroundTaskId === 'string' && raw.backgroundTaskId) {
    return raw.backgroundTaskId
  }
  const isLaunched = raw.status === 'async_launched' || raw.status === 'remote_launched'
  return isLaunched && typeof raw.agentId === 'string' && raw.agentId ? raw.agentId : null
}

// <task-notification> 입력에서 끝난 작업 id 를 뽑는다. 아직 도는 중이라는 알림은 빼고 본다
export const finishedTaskIds = (text: string): string[] =>
  [...text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)]
    .map(match => match[1] ?? '')
    .filter(body => !/<status>\s*(running|pending)\s*<\/status>/.test(body))
    .map(body => body.match(/<task-id>\s*([^<\s]+)\s*<\/task-id>/)?.[1] ?? null)
    .filter((id): id is string => id !== null)

// 끝난 것과 너무 오래된 것을 뺀, 아직 도는 백그라운드 작업
export const pendingTasks = (
  tasks: readonly BackgroundTask[],
  now: number,
  finished: readonly string[] = [],
): BackgroundTask[] => tasks.filter(task => !finished.includes(task.id) && now - task.at < BACKGROUND_MAX_MS)

const KIND_ORDER: Record<Attention['kind'], number> = { permission: 0, question: 1, answered: 2 }

const entryOf = (session: SessionStatus, since: number, withProject: boolean): BoardEntry => {
  const name = (session.branch && parseIssue(session.branch)) ?? session.branch ?? session.project
  return {
    id: session.id,
    branch: session.branch,
    title: session.title ?? null,
    label: withProject && name !== session.project ? `${session.project} ${name}` : name,
    prompt: session.prompt,
    todos: session.todos,
    check: session.check,
    since,
    attention: session.attention ?? null,
  }
}

// 세션을 내 차례, 진행 중, 빈 대기, 숨길 것으로 나눈다. 내 차례는 막힌 정도와 오래 기다린 순서로 둔다
// merged 는 MR 이 머지된 브랜치. 그 브랜치에서 답을 끝낸 세션은 할 일이 끝난 것이라 빈 대기로 둔다
export const triage = (
  sessions: readonly SessionStatus[],
  ownId: string | null,
  now: number,
  merged: ReadonlySet<string> = new Set(),
): Board => {
  const hidden = { stale: 0, ended: 0 }
  const mine: Array<[SessionStatus, number]> = []
  const running: Array<[SessionStatus, number]> = []
  const idle: Array<[SessionStatus, number]> = []
  for (const session of sessions) {
    if (session.id === ownId) {
      continue
    }
    const liveness: Liveness = livenessOf(session, now)
    if (liveness === 'stale' || liveness === 'ended') {
      if (now - session.updatedAt <= KEEP_MS) {
        hidden[liveness] += 1
      }
      continue
    }
    // 질문 도구와 권한 창은 턴 도중에 뜨므로 작업 중이어도 내 차례다. 새 요청을 보내면 attention 이 비워진다
    const attention = session.attention ?? null
    const isMergedDone = attention?.kind === 'answered' && session.branch !== null && merged.has(session.branch)
    if (attention && !isMergedDone) {
      mine.push([session, attention.since])
    } else if (liveness === 'working') {
      running.push([session, session.workingSince ?? session.updatedAt])
    } else {
      idle.push([session, attention?.since ?? session.waitingSince ?? session.updatedAt])
    }
  }
  const hasManyProjects = new Set([...mine, ...running].map(([session]) => session.project)).size > 1
  const toEntry = ([session, since]: [SessionStatus, number]) => entryOf(session, since, hasManyProjects)
  return {
    mine: mine
      .map(toEntry)
      .sort((a, b) => KIND_ORDER[a.attention!.kind] - KIND_ORDER[b.attention!.kind] || a.since - b.since),
    running: running.map(toEntry).sort((a, b) => a.since - b.since),
    // 어느 프로젝트에 열어 둔 것인지가 핵심이라 늘 프로젝트를 붙인다
    idle: idle.map(([session, since]) => entryOf(session, since, true)).sort((a, b) => a.since - b.since),
    hidden,
  }
}

export const formatAgo = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return '방금'
  }
  if (minutes < 60) {
    return `${minutes}분 전`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`
}

// 기다리거나 일한 시간. 오래될수록 병목이다
export const formatFor = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) {
    return '방금'
  }
  if (minutes < 60) {
    return `${minutes}분째`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}시간째` : `${Math.floor(hours / 24)}일째`
}

// transcript 에서 /resume 목록에 보이는 이름을 고른다. /rename 으로 지은 이름이 자동 제목보다 먼저고, 둘 다 마지막 것이 지금 이름이다
export const pickTitle = (lines: string): string | null => {
  let custom: string | null = null
  let ai: string | null = null
  for (const line of lines.split('\n')) {
    try {
      const entry = JSON.parse(line) as { type?: unknown; customTitle?: unknown; aiTitle?: unknown }
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string' && entry.customTitle) {
        custom = entry.customTitle
      } else if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle) {
        ai = entry.aiTitle
      }
    } catch {
      // 잘린 줄은 건너뛴다
    }
  }
  return custom ?? ai
}

// Claude Code 가 transcript 를 두는 곳. 프로젝트 경로의 영숫자 아닌 글자를 - 로 바꾼 폴더다
export const transcriptPathOf = (home: string, projectDir: string, id: string): string =>
  `${home}/.claude/projects/${projectDir.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`

// 공유 캐시가 언제 조회됐고 다음 조회가 언제인지. 주기가 지났으면 어느 세션이든 곧 다시 부른다
export const freshness = (fetchedAt: number | null, ttlMs: number, now: number): string => {
  if (fetchedAt === null) {
    return '아직 조회 전'
  }
  const left = Math.ceil((fetchedAt + ttlMs - now) / 60_000)
  return `${formatAgo(now - fetchedAt)} 조회, ${left > 0 ? `${left}분 뒤 다시` : '곧 다시'}`
}
