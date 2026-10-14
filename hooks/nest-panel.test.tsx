import { expect, mock, test } from 'claude-code/testing'

import type { BoxEntry, Pokedex } from '../types'
import { emptyPokedex } from './nest-lib'

const NOW = 1_000_000

const entry = (key: string, species: number, at: number): BoxEntry => ({ key, species, root: '/p/a', branch: null, label: key, at })

test('옆에 붙은 패널은 PC BOX 머리줄에 앞장선 포켓몬과 경험치를 보이고 칸마다 그림을 그린다', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dex: Pokedex = { ...emptyPokedex(), box: [entry('a', 19, 1), entry('b', 6, 2)], lead: 'a', xp: 0 }
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', ($, e) => ({ value: (e as unknown as { path: string }).path.endsWith('mod-hud-pokedex.json') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', ($, e) => {
    const path = (e as unknown as { path: string }).path
    if (path.endsWith('mod-hud-pokedex.json')) {
      return { value: JSON.stringify(dex) }
    }
    if (path.endsWith('names-en.json')) {
      return { value: JSON.stringify({ 19: 'Rattata', 6: 'Charizard' }) }
    }
    throw new Error('ENOENT')
  })
  on('fs.write', () => ({ value: undefined }))
  on('http.fetch', () => ({ value: { ok: false, status: 404, text: '' } }) as never)
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
  expect(await pane.find({ type: 'Text', text: /PC BOX/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /★ Rattata ░░░░░ 3h0m/ })).toBeDefined()
  // 폭 60 은 한 줄에 세 칸이고, 빈 칸도 벽으로 그린다
  expect(await pane.find({ type: 'Raster', key: 'tile-2' } as never)).toBeDefined()
  expect(await pane.find({ type: 'Raster', key: 'tile-3' } as never)).toBeUndefined()
  // 진화할 수 있는 포켓몬이 있으면 앞장을 고르는 버튼이 있다
  expect(await pane.find({ type: 'Button', label: 'Lead ▶' } as never)).toBeDefined()
  await pane.unmount()
})
