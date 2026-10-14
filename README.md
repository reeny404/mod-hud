# mod-hud

English | [한국어](README.ko.md)

> *"Your very own POKéMON legend is about to unfold! A world of dreams and adventures with POKéMON awaits! Let's go!"*
> — Professor Oak, Pokémon Red and Blue

Every Claude Code session you open takes a Pokémon egg from the DAY CARE.
The egg rocks while the session works, cracks when your MR opens, and hatches the moment it is merged.
Leave a Pokémon at the DAY CARE and it grows while you work, until one day it evolves right in front of you.
And who knows, keep at it long enough and you might just run into a legendary Pokémon.

**Gotta catch 'em all!**

![Eggs, DAY CARE and PC BOX at the bottom of the panel](docs/images/nest.png)

## What you get

- **An egg per session.** Each working session takes one of the 7 eggs the DAY CARE gets every day. Only unevolved Gen 1 Pokémon come out of eggs.
- **PC BOX.** Hatched Pokémon go here when the session closes. Hover an icon to see it at full size.
- **DAY CARE.** The Pokémon you leave here hops around the grass and gains experience only while your sessions are actually working. Every 3 hours of work it evolves one stage.
- **A session HUD, too.** A line above the prompt and the `/mod-hud` panel show which sessions are waiting on you, which are working, your worktrees, MRs that need you, and Linear mentions. Sections you have no setup for simply stay hidden.

It runs inside the Claude Code engine, so there is no Node, npm or React to install, and it works whatever your project's language.

## So how do I set it up?

1. Install it from a Claude Code terminal and choose the `user` scope, so it runs in every project.

   ```bash
   claude plugin marketplace add reeny404/mod-hud
   claude plugin install mod-hud@hyoyyoi
   ```

2. Open a new session, or run `/reload-plugins` in an open one.
3. Type `/mod-hud` to open the panel. The eggs, DAY CARE and PC BOX appear at the bottom of the panel when it is docked beside the conversation.
4. Optional: to have eggs crack and hatch on your GitLab MRs, give it a GitLab token with `read_api` scope:

   ```json
   // ~/.claude/settings.json
   { "env": { "GITLAB_TOKEN": "<token>" } }
   ```

That's it. For every option and what each one does, run:

```
/mod-hud --help
```

### Or let Claude set it up

Paste this into Claude Code:

```text
Install the mod-hud Claude Code plugin for me: run
`claude plugin marketplace add reeny404/mod-hud` and
`claude plugin install mod-hud@hyoyyoi` with the user scope.
Then ask me whether I use GitLab. If I do, ask for a GitLab token with
read_api scope and add it as GITLAB_TOKEN under "env" in
~/.claude/settings.json. Finally tell me to run /reload-plugins and
/mod-hud, and to run /mod-hud --help to see the other options.
```

### Updating

```bash
claude plugin marketplace update hyoyyoi
claude plugin update mod-hud
```

## Known limitations

- A session with an open permission prompt is not yet raised as "permission", because Claude Code doesn't pass that event to mods.
- Issue keys are read from branch names, so they need an uppercase key, as in `feat/#ABC-12-x` or `fix/ABC-12-x`.

## Development

```bash
claude plugin validate .
claude plugin test .
```
