// /mod-hud --help 가 보이는 설정 안내. README 는 짧게 두고 상세한 설정은 여기서 알려 준다

export function isHelp(args: string): boolean {
  return ['--help', '-h', 'help'].includes(args.trim())
}

export function helpText(): string {
  return [
    'mod-hud: see which session is waiting on you, and raise a Pokémon egg in every session.',
    '',
    'Commands',
    '  /mod-hud              open or close the panel',
    '  /mod-hud dashboard    take this session out of the Pokémon eggs (run again to put it back)',
    '  /mod-hud --help       show this help',
    '',
    'GitLab MR status (Worktree, MR sections, eggs cracking and hatching)',
    '  Needs a token with read_api scope, found in this order:',
    '    1. the GITLAB_TOKEN environment variable',
    '       e.g. ~/.claude/settings.json: { "env": { "GITLAB_TOKEN": "<token>" } }',
    '    2. GITLAB_TOKEN=... in .env.local at the repository root',
    '',
    'Linear Inbox',
    '  Shows up when the Linear connector is enabled on claude.ai.',
    '',
    'Options (/config > mod-hud, or claude plugin install mod-hud@hyoyyoi --config key=value)',
    '  gitlabUrl     GitLab API address. Empty: worked out from the origin remote.',
    '                Set it only when the remote is ssh and the web port differs.',
    '  baseBranch    Branch commits are counted against. Empty: origin/HEAD, then main.',
    '  autoCleanup   false by default. When true, removes a worktree and its local branch',
    '                once its MR is merged, nothing is left uncommitted, local HEAD equals',
    '                the MR head, and no session is open there.',
    '',
    'Files',
    '  ~/.claude/mod-sessions/          one status file per session (removed after a day)',
    '  ~/.claude/mod-hud-pokedex.json   eggs, DAY CARE and PC BOX, shared by every session',
    '  ~/.claude/mod-hud-sprites/       Pokémon icons and names cached from PokeAPI',
  ].join('\n')
}
