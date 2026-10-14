# mod-hud

[English](README.md) | 한국어

Claude Code 세션을 여러 개 띄워 두고 일할 때, 어느 세션이 나를 기다리는지 한눈에 보이게 하는 mod 다.
입력창 위에 한 줄이 늘 보이고, `/mod-hud` 로 패널을 연다.
일하는 동안 세션마다 포켓몬 알을 하나씩 키우고, MR 이 머지되면 알이 깨진다.

Claude Code 엔진 안에서 도는 코드라서 Node, npm, React 를 따로 설치할 필요가 없다. 프로젝트 언어(Python 등)와도 상관없다.

## 보이는 것

| 섹션 | 내용 | 필요한 것 |
| --- | --- | --- |
| Your turn | 답을 끝냈거나 질문하고 멈춘 세션. 1분 넘게 그대로면 OS 알림을 보낸다 | 없음 |
| Working | 일하는 세션, 할 일 진행률, 실패한 검사(pytest, ruff, mypy, pnpm test 등) | 없음 |
| Worktree | 지금 저장소의 worktree 별 브랜치, 기준 브랜치 대비 커밋 수, 변경 수, MR 상태 | git 저장소. MR 은 GitLab 과 토큰 |
| MR | 충돌이 났거나 머지할 수 있는 MR | GitLab 과 토큰 |
| Linear Inbox | 나를 멘션했거나 내 댓글에 답한 안 읽은 Linear 알림. GitLab 이 바꾼 상태 알림은 뺀다 | claude.ai 의 Linear 커넥터 |
| 포켓몬 알 | 패널 바닥에 세션마다 둥지, 키우미집, PC BOX. [포켓몬 알](#포켓몬-알) 참고 | 대화 옆에 붙은 패널. 그림을 받으려면 `curl` 과 네트워크 |

필요한 것이 없는 섹션은 그냥 보이지 않는다.

패널의 글자는 모두 영어다.

## 포켓몬 알

![패널 바닥의 알, 키우미집, PC BOX](docs/images/nest.png)

옆에 붙은 패널 바닥에 열린 세션마다 둥지가 하나 있다.

- **키우미집(DAY CARE)**: 매일 로컬 자정에 알 7개가 채워진다. 남은 알은 넘어가지 않는다. 남은 알 수가 늘 보이고, 비면 `0` 이다. 일을 시작한 세션이 여기서 알을 하나 받는다. 비어 있으면 세션은 빈 둥지로 남고, 알이 돌아오면 일하고 있는 빈 세션이 받는다.
- **알**: 둥근 연두 반점 알이고, 반점 무늬는 여섯 가지 중 하나다. 세션이 일하면 오뚝이처럼 까딱이고(노란 라벨), 그 브랜치의 MR 이 열리면 금이 가고, MR 이 머지되면 포켓몬이 나와 통통 뛴다. 빨간 라벨은 그 세션이 나를 기다린다는 뜻이다. 알을 받기 전에 머지된 MR 로는 깨지지 않는다. 알에서는 1세대 중 진화 전 모습이고 전설이 아닌 74종만 나오고, 어느 포켓몬인지는 알이 정한다.
- **세션이 닫히면**: 부화한 포켓몬은 PC BOX 로 간다. 그 전에 "Send to PC BOX" 버튼을 누르면 바로 간다. MR 이 열려 있는 알은 금 간 채 남아 머지를 기다린다. MR 없이 닫힌 세션의 알은 키우미집으로 돌아간다.
- **PC BOX**: 한 페이지에 18점 아이콘 한 줄이 보인다. 아래 ◀ Prev / Next ▶ 버튼으로 페이지를 넘긴다. 아이콘에 마우스를 올리면 그 포켓몬이 원본 크기로 이름, 잡은 날, 다음 진화와 함께 뜬다.
- **진화**: PC BOX 의 포켓몬 한 마리가 앞장서서(★) 세션이 일하는 동안 경험치를 먹는다. 세션이 일한 시간 3시간마다(세션 셋이 1시간 일하면 3시간) 한 단계 진화하고 막대는 처음부터 다시 찬다. 머리줄에 앞장선 포켓몬과 막대, 남은 시간이 `★ Bulbasaur ▓▓░░░ 1h48m` 처럼 보인다. 앞장설 포켓몬은 마우스 카드의 **Set as lead** 로 고르거나 ◀ Lead / Lead ▶ 로 넘겨 고른다. 고르지 않으면 3마리 이상 모인 종이 먼저, 그다음은 가장 먼저 잡은 포켓몬이 앞장선다. 앞장선 포켓몬은 최종 진화형이 될 때까지 바뀌지 않는다. 5분 넘게 끊긴 시간(잠자기, 세션이 모두 꺼진 시간)은 세지 않는다. 진화는 1세대 안에서만 하고, 이브이는 셋 중 하나로 진화한다.
- **전설 포켓몬**은 알에서 나오지 않고, 조건을 채우면 PC BOX 에 한 번씩 온다.

  | 전설 | 조건 |
  | --- | --- |
  | 프리저 | 진화로 얼음 타입 최종 진화형을 처음 만든다(쥬레곤, 파르셀) |
  | 썬더 | 진화로 전기 타입 최종 진화형을 처음 만든다(라이츄, 레어코일, 붐볼, 쥬피썬더) |
  | 파이어 | 진화로 불꽃 타입 최종 진화형을 처음 만든다(리자몽, 나인테일, 윈디, 날쌩마, 부스터) |
  | 뮤츠 | PC BOX 에 들어온 종이 100종이 된다 |
  | 뮤 | 뮤를 뺀 150종이 모두 PC BOX 에 들어왔다 |

- 대시보드로 쓰는 세션은 `/mod-hud dashboard` 로 표시하면 알 목록에서 빠진다. 한 번 더 입력하면 푼다.

기록은 `~/.claude/mod-hud-pokedex.json` 에 남아 모든 세션과 저장소가 같이 본다. 그림(7세대 박스 아이콘)과 영어 이름은 처음 필요할 때 [PokeAPI](https://pokeapi.co) 에서 받아 `~/.claude/mod-hud-sprites/` 에 두고, 받기 전에는 몬스터볼을 그린다.

## 설치

Claude Code 터미널에서 마켓플레이스를 추가하고 설치한다.

```bash
claude plugin marketplace add reeny404/mod-hud
claude plugin install mod-hud@hyoyyoi
```

설치할 때 scope 는 user 를 고른다. 그러면 모든 프로젝트의 세션에서 켜진다.
설치 뒤 새 세션을 열거나 열려 있는 세션에서 `/reload-plugins` 를 하고 `/mod-hud` 를 입력해 패널이 뜨는지 본다.

업데이트는 이렇게 받는다.

```bash
claude plugin marketplace update hyoyyoi
claude plugin update mod-hud
```

## GitLab MR 을 보려면

origin remote 가 GitLab 이면 MR 을 조회한다. 토큰은 다음 순서로 찾는다.

1. 환경 변수 `GITLAB_TOKEN`
2. 저장소 루트의 `.env.local` 안의 `GITLAB_TOKEN=...`

환경 변수로 줄 때는 `~/.claude/settings.json` 의 `env` 에 넣으면 Claude Code 세션에만 적용된다.

```json
{ "env": { "GITLAB_TOKEN": "<read_api 권한 토큰>" } }
```

토큰은 GitLab > Preferences > Access Tokens 에서 `read_api` scope 로 만든다.

## 옵션

`/config` 의 플러그인 설정이나 설치 화면에서 바꾼다.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `gitlabUrl` | 비움 | GitLab API 주소. 비우면 remote 주소에서 계산한다. ssh remote 인데 웹 포트가 다를 때만 넣는다 |
| `baseBranch` | 비움 | 커밋 수를 셀 기준 브랜치. 비우면 `origin/HEAD`, 없으면 `main` |
| `autoCleanup` | `false` | MR 이 머지됐고 남은 변경이 없는 worktree 와 로컬 브랜치를 자동으로 지운다 |

### autoCleanup 켜기

worktree 와 브랜치를 지우는 옵션이라 기본으로 꺼 두었다. 켜는 방법은 셋 중 하나다.

- 설치하면서 켠다: `claude plugin install mod-hud@hyoyyoi --config autoCleanup=true`
- 설치한 뒤 켠다: Claude Code 에서 `/config` 를 열고 mod-hud 의 `Auto cleanup merged worktrees` 를 켠다
- `--plugin-dir` 이나 `CLAUDE_CODE_PLUGIN_DIRS` 로 폴더를 직접 띄우는 경우: `~/.claude/settings.json` 에 넣는다

  ```json
  { "pluginConfigs": { "mod-hud": { "options": { "autoCleanup": true } } } }
  ```

켜 두면 2분마다 worktree 를 조회할 때 아래 조건을 모두 만족하는 worktree 만 지운다.

- 메인 worktree 가 아니다
- 그 브랜치의 MR 이 merged 다 (그래서 GitLab 토큰이 있어야 동작한다)
- 커밋하지 않은 변경이 없다
- 로컬 HEAD 가 MR 의 마지막 커밋과 같다. MR 에 없는 커밋이 있으면 지우지 않는다
- 그 worktree 에서 열린 세션이 없다. 하루 넘게 입력만 기다린 세션은 열린 것으로 치지 않는다

지울 때는 `git worktree remove` 뒤 로컬 브랜치를 `git branch -D` 로 지운다. squash 머지여도 지워지게 `-D` 를 쓰며, 위 HEAD 조건 덕분에 MR 에 없는 커밋은 잃지 않는다.
지우면 토스트로 알리고 Worktree 섹션 아래에 한 줄 남긴다. 조건 중 하나가 걸리면 지우지 않고 그 이유를 `merged, cleanup on hold: ...` 로 보인다.

## 알려진 한계

- 권한 승인 창이 떠 있는 세션을 "permission"으로 올리는 기능은 Claude Code 가 mod 에 알림 이벤트를 넘겨주지 않아 지금은 동작하지 않는다.
- 세션 상태는 `~/.claude/mod-sessions/` 에 세션마다 파일로 남고, 하루 지난 파일은 지운다.
- 브랜치 이름에서 이슈 번호를 읽는다. `feat/#ABC-12-x`, `fix/ABC-12-x` 처럼 대문자 키가 있어야 한다.

## 개발

```bash
claude plugin validate .
claude plugin test .
```
