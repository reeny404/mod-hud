# mod-hud

[English](README.md) | 한국어

> *"Your very own POKéMON legend is about to unfold! A world of dreams and adventures with POKéMON awaits! Let's go!"*
> — 오박사, 포켓몬스터 레드·블루
>
> (너만의 포켓몬 전설이 이제 막 펼쳐지려 하고 있다! 꿈과 모험과 포켓몬의 세계가 기다리고 있다! 자, 가자!)

Claude Code 세션을 열 때마다 키우미집에서 포켓몬 알을 하나 받는다.
알은 세션이 일하는 동안 흔들리고, MR 이 열리면 금이 가고, 머지되는 순간 깨진다.
키우미집에 포켓몬을 맡겨 두면 내가 일하는 만큼 자라서, 어느 날 눈앞에서 진화한다.
그리고 열심히 하다 보면, 어쩌면 당신도 전설의 포켓몬을 만날지 모른다.

**Gotta catch 'em all!**

![패널 바닥의 알, 키우미집, PC BOX](docs/images/nest.png)

## 무엇을 하나

- **세션마다 알 하나.** 키우미집에는 매일 알 7개가 들어오고, 일을 시작한 세션이 하나씩 받아 간다. 알에서는 1세대 중 진화 전 모습의 포켓몬만 나온다.
- **PC BOX.** 부화한 포켓몬은 세션이 닫히면 여기로 간다. 포켓몬 골드 버전의 PC BOX 처럼 한 줄에 한 마리씩 이름과 속성을 보이고, 줄을 누르면 도트와 언제 어디서 잡았는지 보인다. 어떤 포켓몬이든 키우미집에 맡길 수 있고, 더 진화하지 않는 포켓몬은 MAX 로 보인다.
- **키우미집(DAY CARE).** 맡긴 포켓몬은 풀밭을 통통 뛰어다니고, 세션이 실제로 일하는 동안에만 경험치를 얻는다. 일한 시간 3시간마다 한 단계 진화한다.
- **세션 HUD 도 겸한다.** 입력창 위 한 줄과 `/mod-hud` 패널에서 나를 기다리는 세션, 일하는 세션, worktree, 손봐야 할 MR, Linear 멘션을 본다. 설정하지 않은 섹션은 그냥 보이지 않는다.

Claude Code 엔진 안에서 도는 코드라 Node, npm, React 를 따로 설치할 필요가 없고, 프로젝트 언어와도 상관없다.

## 그래서 어떻게 설정하지?

1. Claude Code 터미널에서 설치한다. scope 는 `user` 를 골라야 모든 프로젝트에서 켜진다.

   ```bash
   claude plugin marketplace add reeny404/mod-hud
   claude plugin install mod-hud@hyoyyoi
   ```

2. 새 세션을 열거나, 열려 있는 세션에서 `/reload-plugins` 를 한다.
3. `/mod-hud` 로 패널을 연다. 패널을 대화 옆에 붙이면 패널 바닥에 알, 키우미집, PC BOX 가 보인다.
4. 선택: GitLab MR 에 맞춰 알이 금 가고 깨지게 하려면 `read_api` 권한 GitLab 토큰을 넣는다.

   ```json
   // ~/.claude/settings.json
   { "env": { "GITLAB_TOKEN": "<토큰>" } }
   ```

끝이다. 다른 옵션과 각 옵션이 하는 일은 이렇게 본다.

```
/mod-hud --help
```

### Claude 에게 맡기기

아래를 Claude Code 에 그대로 붙여 넣으면 된다.

```text
mod-hud Claude Code 플러그인을 설치해 줘.
`claude plugin marketplace add reeny404/mod-hud` 와
`claude plugin install mod-hud@hyoyyoi` 를 user scope 로 실행해 줘.
그다음 내가 GitLab 을 쓰는지 물어보고, 쓰면 read_api 권한 GitLab 토큰을 받아
~/.claude/settings.json 의 "env" 에 GITLAB_TOKEN 으로 넣어 줘.
마지막으로 /reload-plugins 와 /mod-hud 를 하라고, 다른 옵션은
/mod-hud --help 로 보라고 알려 줘.
```

### 업데이트

```bash
claude plugin marketplace update hyoyyoi
claude plugin update mod-hud
```

## 알려진 한계

- 권한 승인 창이 떠 있는 세션을 "permission" 으로 올리는 기능은 Claude Code 가 mod 에 그 이벤트를 넘겨주지 않아 아직 동작하지 않는다.
- 브랜치 이름에서 이슈 번호를 읽는다. `feat/#ABC-12-x`, `fix/ABC-12-x` 처럼 대문자 키가 있어야 한다.

## 개발

```bash
claude plugin validate .
claude plugin test .
```
