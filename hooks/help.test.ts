import { expect, test } from 'claude-code/testing'

import { helpText, isHelp } from './help-lib'

test('/mod-hud --help 는 설정할 수 있는 것과 쓰는 법을 글로 알려 준다', () => {
  for (const word of ['/mod-hud dashboard', 'GITLAB_TOKEN', 'gitlabUrl', 'baseBranch', 'autoCleanup', 'pokemonLanguage', 'mod-hud-pokedex.json', '/config']) {
    expect(helpText()).toContain(word)
  }
  expect(isHelp('--help')).toBe(true)
  expect(isHelp(' help ')).toBe(true)
  expect(isHelp('-h')).toBe(true)
  expect(isHelp('dashboard')).toBe(false)
  expect(isHelp('')).toBe(false)
})
