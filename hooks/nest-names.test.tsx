import { expect, mock, test } from 'claude-code/testing'

import type { BoxEntry, Pokedex } from '../types'
import { emptyPokedex } from './nest-lib'

const NOW = 1_000_000

const entry = (key: string, species: number, at: number): BoxEntry => ({ key, species, root: '/p/a', branch: null, label: key, at })

test('이름을 아직 모르면 패널은 이름을 기다리지 않고 도감 번호로 먼저 그린다', { timeoutMs: 3000 }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1)], lead: 'a' }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    if ((e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', () => ({ value: undefined }))
  // 네트워크가 끝내 답하지 않는다
  on('http.fetch', () => new Promise(() => {}) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/a' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.blit', () => ({ value: { deny: false } }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/p/a' } as never)

  const props = { placement: 'dock', bodyColumns: 60, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  expect(await pane.find({ type: 'Text', text: /★ No\.19/ })).toBeDefined()
  await pane.unmount()
})

test('pokemonLanguage 가 ko 면 한국어 이름을 PokeAPI 에서 받아 언어별 파일에 두고 패널에 쓴다', { options: { pokemonLanguage: 'ko' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1)], lead: 'a' }
  const written: string[] = []
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    // 영어 이름 파일은 읽지 않는다
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 19: 'Rattata' }) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', ($, e) => {
    written.push((e as unknown as { path: string }).path)
    return { value: undefined }
  })
  on('http.fetch', ($, e) => {
    const url = (e as unknown as { url: string }).url
    if (url.endsWith('/pokemon-species/19')) {
      const names = [
        { name: 'Rattata', language: { name: 'en' } },
        { name: '꼬렛', language: { name: 'ko' } },
      ]
      return { value: { ok: true, status: 200, text: JSON.stringify({ names }) } } as never
    }
    return { value: { ok: false, status: 404, text: '' } } as never
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', () => ({ value: { name: 'x' } }) as never)
  on('session.id', () => ({ value: 'self' }))
  on('session.cwd', () => ({ value: '/p/a' }))
  on('session.repo', () => ({ value: null }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.blit', () => ({ value: { deny: false } }) as never)
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/p/a' } as never)

  const props = { placement: 'dock', bodyColumns: 60, scroll: { bodyRows: 60 } }
  const pane = await $.ui.mount({ plugin: 'mod-hud', surface: 'terminal', component: 'Pane', requestId: 'mod-hud', props } as never)
  // 처음 그릴 때는 이름을 몰라 도감 번호로 그리고, 받은 뒤 다시 그린다
  await pane.drawn()
  expect(await pane.find({ type: 'Text', text: /꼬렛/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Rattata/ })).toBeUndefined()
  expect(written).toContain('/home/test/.claude/mod-hud-sprites/names-ko.json')
  await pane.unmount()
})
