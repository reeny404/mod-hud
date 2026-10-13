export type Check = { name: string; isOk: boolean; at: number }

export type TodoItem = { id: string; label: string; status: 'pending' | 'in_progress' | 'completed' }

export type TodoSummary = { done: number; total: number; current: string | null }

// 이슈 패널이 worktree 에 세션을 붙일 때 쓰는 부분만
export type TreeSession = {
  id: string
  cwd: string
  state: 'working' | 'waiting' | 'ended'
  updatedAt: number
  // 입력 대기에 들어간 시각. heartbeat 가 updatedAt 을 계속 바꾸므로 따로 둔다
  waitingSince?: number
  check?: Check
}

// 세션이 나를 기다리는 이유. permission 은 작업 중에도 생긴다
export type Attention = {
  kind: 'permission' | 'question' | 'answered'
  since: number
  // 권한 요청 문구나 질문 한 줄. answered 는 null
  text: string | null
}

// 모든 세션이 ~/.claude/mod-sessions/<id>.json 에 쓰는 상태
export type SessionStatus = TreeSession & {
  root: string
  project: string
  branch: string | null
  prompt: string | null
  todos: TodoSummary | null
  attention?: Attention | null
  // /resume 목록에 보이는 이름. /rename 으로 지은 이름이나 자동 제목
  title?: string | null
  // 마지막 요청을 받은 시각
  workingSince?: number
  // 백그라운드로 띄우고 아직 끝났다는 알림을 받지 못한 작업
  background?: BackgroundTask[]
}

// 백그라운드 Bash 의 backgroundTaskId 나 백그라운드 Agent 의 agentId 와 띄운 시각
export type BackgroundTask = { id: string; at: number }

export type Liveness = 'working' | 'waiting' | 'stale' | 'ended'

// 패널 한 줄에 보일 세션
export type BoardEntry = {
  id: string
  label: string
  // /resume 목록에서 찾을 수 있는 이름
  title: string | null
  branch: string | null
  prompt: string | null
  todos: TodoSummary | null
  check?: Check
  // 내 차례면 기다리기 시작한 시각, 진행 중이면 요청을 받은 시각
  since: number
  attention: Attention | null
}

// 세션을 내가 할 일 기준으로 나눈 것. 이 세션은 넣지 않는다
export type Board = {
  mine: BoardEntry[]
  running: BoardEntry[]
  // 요청 없이 열려만 있는 세션. since 는 열린 시각
  idle: BoardEntry[]
  hidden: { stale: number; ended: number }
}

export type SessionsMeta = { refreshedAt: number | null; ownId: string | null }

// action 은 열린 MR 에서 내가 움직여야 하는 것. 그 밖의 상태는 null
export type Mr = { iid: number; state: string; sha: string; url: string; action: 'mergeable' | 'conflict' | null }

export type Tree = { path: string; head: string; branch: string | null; isMain: boolean }

export type Row = Tree & {
  issue: string | null
  ahead: number
  dirty: number
  session: TreeSession | null
  mr: Mr | null
  linear: string | null
  note: string | null
}

export type IssuesMeta = { refreshedAt: number | null; isRefreshing: boolean; log: string[] }

// 같은 저장소의 세션이 같이 쓰는 ~/.claude/ 아래 파일. 한 세션만 git, GitLab, Linear 를 부르고 나머지는 이 파일을 읽는다
export type IssuesCache = {
  fetchedAt: number | null
  rows: Row[]
  // 살아 있는 세션이 일한 브랜치의 MR. 세션 줄의 MR 링크와 머지 여부에 쓴다
  branchMrs: Record<string, Mr>
  // 최근 정리 기록
  log: string[]
  lease: { by: string; at: number } | null
}

// Linear 알림 한 건. get_notifications 응답에서 쓰는 필드만
export type InboxItem = {
  id: string
  type: string
  category: string | null
  title: string
  subtitle: string | null
  url: string | null
  issue: string | null
  createdAt: number
}

// 모든 세션이 같이 쓰는 ~/.claude/mod-inbox.json. 한 세션만 Linear 를 부르고 나머지는 이 파일을 읽는다
export type InboxCache = {
  fetchedAt: number | null
  // 마지막으로 조회에 성공한 시각. fetchedAt 과 다르면 마지막 조회가 실패한 것
  okAt: number | null
  notifications: InboxItem[]
  // 이미 토스트했거나 첫 조회 때 있던 알림 id
  seenIds: string[]
  // 지금 조회를 맡은 세션
  lease: { by: string; at: number } | null
}

export type Inbox = { items: InboxItem[]; fetchedAt: number | null; isOk: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mod-hud': {
      rows: Row[]
      branchMrs: Record<string, Mr>
      issuesMeta: IssuesMeta
      board: Board
      sessionsMeta: SessionsMeta
      inbox: Inbox
    }
  }
}
