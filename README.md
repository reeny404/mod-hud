# mod-hud

English | [한국어](README.ko.md)

A Claude Code mod that shows, at a glance, which of your many open Claude Code sessions is waiting on you.
A one-line band always sits above the prompt, and `/mod-hud` opens the full panel.

It runs inside the Claude Code engine, so there is no Node, npm or React to install, and it works regardless of your project's language (Python and so on).

## What it shows

| Section | Contents | Requires |
| --- | --- | --- |
| Your turn (내 차례) | Sessions that finished answering or stopped to ask a question. Sends an OS notification if one sits untouched for over a minute | Nothing |
| In progress (진행 중) | Working sessions, todo progress, failing checks (pytest, ruff, mypy, pnpm test, etc.) | Nothing |
| Worktree | For each worktree of the current repo: branch, commits ahead of the base branch, number of changes, MR status | A git repo. MR status needs GitLab and a token |
| MR | MRs that have conflicts or are ready to merge | GitLab and a token |
| Linear Inbox | Unread Linear notifications where you were mentioned or someone replied to your comment. Status changes made by GitLab are left out | The Linear connector on claude.ai |

Sections whose requirements aren't met are simply hidden.

The panel labels are in Korean.

## Install

Add the marketplace and install from a Claude Code terminal.

```bash
claude plugin marketplace add reeny404/mod-hud
claude plugin install mod-hud@hyoyyoi
```

Choose the `user` scope when installing, so it's enabled in sessions for every project.
After installing, open a new session (or run `/reload-plugins` in an open one), then type `/mod-hud` to check that the panel appears.

To update:

```bash
claude plugin marketplace update hyoyyoi
claude plugin update mod-hud
```

## Showing GitLab MRs

If the `origin` remote is GitLab, mod-hud looks up MRs. It looks for a token in this order:

1. The `GITLAB_TOKEN` environment variable
2. `GITLAB_TOKEN=...` in `.env.local` at the repo root

To pass it as an environment variable, put it under `env` in `~/.claude/settings.json` so it only applies to Claude Code sessions.

```json
{ "env": { "GITLAB_TOKEN": "<token with read_api scope>" } }
```

Create the token in GitLab > Preferences > Access Tokens with the `read_api` scope.

## Options

Change these in the plugin settings under `/config`, or on the install screen.

| Option | Default | Description |
| --- | --- | --- |
| `gitlabUrl` | empty | GitLab API URL. When empty it's derived from the remote URL. Only set it when you use an ssh remote and the web port differs |
| `baseBranch` | empty | Branch to count commits against. When empty, `origin/HEAD`, falling back to `main` |
| `autoCleanup` | `false` | Automatically removes worktrees and local branches whose MR is merged and that have no remaining changes |

### Turning on autoCleanup

It's off by default because it deletes worktrees and branches. Turn it on in one of three ways:

- While installing: `claude plugin install mod-hud@hyoyyoi --config autoCleanup=true`
- After installing: open `/config` in Claude Code and turn on mod-hud's `Auto cleanup merged worktrees`
- If you load the folder directly with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`: add it to `~/.claude/settings.json`

  ```json
  { "pluginConfigs": { "mod-hud": { "options": { "autoCleanup": true } } } }
  ```

When on, each worktree check (every 2 minutes) removes only worktrees that meet all of these:

- It isn't the main worktree
- The branch's MR is merged (so this needs a GitLab token)
- It has no uncommitted changes
- The local HEAD matches the MR's last commit. If there are commits not in the MR, it's kept
- No session is open in that worktree. A session that has only been waiting for input for over a day doesn't count as open

It removes the worktree with `git worktree remove`, then deletes the local branch with `git branch -D`. `-D` is used so squash-merged branches are removed too, and the HEAD check above ensures no commits missing from the MR are lost.
Each removal shows a toast and leaves a line under the Worktree section. If any condition fails, it keeps the worktree and shows the reason as `머지됨, 정리 보류: ...` ("merged, cleanup on hold: ...").

## Known limitations

- Raising a session with an open permission prompt to "permission needed" doesn't work yet, because Claude Code doesn't pass that notification event to mods.
- Session state is kept as one file per session in `~/.claude/mod-sessions/`, and files older than a day are deleted.
- Issue keys are read from branch names, so they need an uppercase key, as in `feat/#ABC-12-x` or `fix/ABC-12-x`.

## Development

```bash
claude plugin validate .
claude plugin test .
```
