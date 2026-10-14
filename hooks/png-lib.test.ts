import { expect, test } from 'claude-code/testing'

import { CLEAR, crop, decodePng, fit } from './png-lib'

const bytesOf = (base64: string) => (Uint8Array as unknown as { fromBase64(text: string): Uint8Array }).fromBase64(base64)

// 3x2 RGBA. 압축하지 않은 블록이고 가운데 위 픽셀만 투명하다
const RGBA =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAJUlEQVR4AQEaAOX/AP8AAP8AAAAAAAD//wAA/wD//////wAAAP96nwr2s+I7igAAAABJRU5ErkJggg=='
// PokeAPI 의 40x30 피카츄 아이콘. 4비트 팔레트에 허프만 압축이다
const ICON = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeBAMAAACs80HuAAAAIVBMVEUxMTExMTFSUlKchEKlazG1cym9lCHFpSn3Y1L31jH///98M3JMAAAAAXRSTlMAQObYZgAAAJVJREFUKJHVjzEKw0AQA7U/uEuR5UqbgLnSpUt/IT9xmiVPcHmGYKvMT1PvxpA6KocRQsCfJZ8w6QBA0gksi4O6ADnv5lQdkftqDoomYW/m6spWOASR5LQFUcgnR/UzhfubTbxZJl7IpLF+rGy+fh14rLzP/mQ2VvLmr0MfrK8OAVpPBhFi5BYhcmGLDJDyJQKQE/YrHwXQKRtr0GeSAAAAAElFTkSuQmCC'

test('압축하지 않은 RGBA PNG 의 색과 투명을 읽는다', () => {
  const image = decodePng(bytesOf(RGBA))
  expect([image.width, image.height]).toEqual([3, 2])
  expect(image.px).toEqual([0xff0000, CLEAR, 0x0000ff, 0x00ff00, 0xffffff, 0x000000])
})

test('허프만으로 압축한 팔레트 PNG 를 읽고 투명한 테두리를 잘라 낸다', () => {
  const image = decodePng(bytesOf(ICON))
  expect([image.width, image.height]).toEqual([40, 30])
  const cropped = crop(image)
  expect(cropped.width < 40 && cropped.height < 30).toBe(true)
  expect(cropped.px.some(color => color !== CLEAR)).toBe(true)
  // 피카츄라 노란 픽셀이 있다
  expect(cropped.px.some(color => color !== CLEAR && color >> 16 > 0xc0 && ((color >> 8) & 255) > 0xa0 && (color & 255) < 0x80)).toBe(true)
})

test('비율을 지켜 정한 크기 안으로 줄인다', () => {
  const image = crop(decodePng(bytesOf(ICON)))
  const small = fit(image, 12)
  expect(Math.max(small.width, small.height)).toBe(12)
  expect(small.px.length).toBe(small.width * small.height)
  // 이미 작으면 키우지 않는다
  expect(fit({ width: 2, height: 1, px: [1, 2] }, 12)).toEqual({ width: 2, height: 1, px: [1, 2] })
})
