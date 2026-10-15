import { expect, test } from 'claude-code/testing'

import { canEvolve, EGG_SPECIES, EVOLUTIONS, typesOf } from './dex-data'

test('알에서 나오는 종은 74종이고 전설과 진화형은 없다', () => {
  expect(EGG_SPECIES.length).toBe(74)
  for (const legend of [144, 145, 146, 150, 151]) {
    expect(EGG_SPECIES).not.toContain(legend)
  }
  const evolved = new Set(Object.values(EVOLUTIONS).flat())
  for (const species of EGG_SPECIES) {
    expect(evolved.has(species)).toBe(false)
  }
  // 피츄, 먹고자는 2세대라 피카츄, 잠만보가 진화 전 모습이다
  expect(EGG_SPECIES).toContain(25)
  expect(EGG_SPECIES).toContain(143)
})

test('진화표는 1세대 안에서만 진화하고 이브이만 갈라진다', () => {
  expect(EVOLUTIONS[133]).toEqual([134, 135, 136])
  expect(Object.values(EVOLUTIONS).flat().every(n => n <= 151)).toBe(true)
  expect(Object.entries(EVOLUTIONS).filter(([, to]) => to.length > 1).map(([from]) => from)).toEqual(['133'])
  // 골뱃은 크로뱃이 되지 않는다
  expect(canEvolve(42)).toBe(false)
  expect(canEvolve(4)).toBe(true)
  expect(canEvolve(6)).toBe(false)
})

test('속성은 골드 버전 기준이라 코일은 강철이 붙고 삐삐는 노말이며, 1세대가 아니면 비운다', () => {
  expect(typesOf(1)).toBe('GRASS/POISON')
  expect(typesOf(6)).toBe('FIRE/FLYING')
  expect(typesOf(25)).toBe('ELECTRIC')
  expect(typesOf(35)).toBe('NORMAL')
  expect(typesOf(81)).toBe('ELECTRIC/STEEL')
  expect(typesOf(94)).toBe('GHOST/POISON')
  expect(typesOf(130)).toBe('WATER/FLYING')
  expect(typesOf(143)).toBe('NORMAL')
  expect(typesOf(149)).toBe('DRAGON/FLYING')
  expect(typesOf(151)).toBe('PSYCHIC')
  expect(typesOf(152)).toBe('')
})
