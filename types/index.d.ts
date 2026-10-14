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
  // 턴은 끝났고 백그라운드 작업만 기다리는 중. heartbeat 가 작업이 끝났는지 다시 본다
  waitingOnTasks?: boolean
  // 이 세션 브랜치의 MR 상태(opened, merged, closed). 포켓몬 알이 금 가고 부화하는 기준이다
  mrState?: string | null
  // mrState 를 조회한 브랜치. 지금 브랜치와 다르면 mrState 는 모르는 것으로 친다. 없으면 이 필드가 생기기 전의 상태 파일이다
  mrBranch?: string | null
  // /mod-hud dashboard 로 대시보드라고 표시한 세션. 포켓몬 알이 없다
  isDashboard?: boolean
  // iTerm2 Claude Code 연동의 Code Review 탭이 띄운 리뷰 세션. 목록과 포켓몬 알에서 뺀다
  isCodeReview?: boolean
  // 세션이 끝난 이유(prompt_input_exit, clear, resume 등)
  endReason?: string
  // /clear 나 /resume 로 이 세션 직전에 같은 창에서 끝난 세션 id. 그 세션의 알을 물려받는다
  predecessor?: string
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
  // 이번 조회에서 MR 을 찾아본 브랜치. branchMrs 에 없으면 MR 이 없는 것이다. 여기 없는 브랜치는 아직 모른다
  checked: string[]
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

// 세션 정보를 붙인 포켓몬 알. key 는 알 이름, species 는 1세대 도감 번호
export type DexEgg = { key: string; species: number; root: string; branch: string | null; label: string; at: number }

// 키우미집에 있거나 세션이 든 알
export type HeldEgg = { key: string; species: number }

// 박스로 간 포켓몬
export type BoxEntry = DexEgg

// 모든 저장소와 세션이 같이 쓰는 ~/.claude/mod-hud-pokedex.json. 살아 있는 세션 중 id 가 가장 작은 세션만 쓴다
export type Pokedex = {
  // 마지막으로 키우미집을 채운 로컬 날짜 YYYY-MM-DD. 빈 문자열이면 아직 안 채웠다
  day: string
  // 알 key 와 그 알의 MR 이 처음 머지된 걸 본 시각
  hatched: Record<string, number>
  // 세션은 닫혔지만 MR 이 열려 있어 머지를 기다리는 알
  pending: Array<DexEgg & { mrState: string }>
  // 진행 중인 세션이 받아 갈 알. 매일 새로 채우고, MR 없이 닫힌 세션의 알도 돌아온다
  daycare: HeldEgg[]
  // 최근에 잡은 것이 앞
  box: BoxEntry[]
  // 세션 id 와 그 세션이 든 알. 세션이 닫혀도 남겨 두고 잠자기에서 돌아올 때 되찾는 데 쓴다
  holds: Record<string, HeldEgg>
  // 이미 정리한 닫힌 세션 id
  done: string[]
  // 세션 id 와 머지돼도 알이 깨지지 않을 브랜치. 박스로 보낸 브랜치나 알을 받을 때 이미 머지된 브랜치다
  sent: Record<string, string | null>
}

// 패널에 그릴 알 하나
export type NestEgg = {
  key: string
  label: string
  species: number
  // 알을 못 받은 세션은 empty, 빈 둥지만 보인다
  stage: 'empty' | 'egg' | 'cracked' | 'hatched'
  isShaking: boolean
  // 세션이 나를 기다리면 mine, 일하는 중이면 working. 라벨 색을 패널의 내 차례, 진행 중과 같게 칠한다
  activity: 'mine' | 'working' | null
  // 처음 머지된 걸 본 시각. 이 뒤 잠깐 동안 높이 뛴다
  hatchedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'mod-hud': {
      rows: Row[]
      branchMrs: Record<string, Mr>
      issuesMeta: IssuesMeta
      board: Board
      sessionsMeta: SessionsMeta
      inbox: Inbox
      pokedex: Pokedex
      eggs: NestEgg[]
    }
  }
}
