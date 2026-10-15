// 포켓몬 스프라이트 PNG 를 읽어 작은 도트로 줄인다. mod 환경에는 zlib 이 없어 inflate 를 직접 한다

// 색이 없는 픽셀. Raster 의 터미널 기본색과 같은 값이라 그대로 칠하면 배경이 비친다
export const CLEAR = 0x01000000

export type Pixels = { width: number; height: number; px: number[] }

// RFC 1951 inflate. 정적, 동적 허프만과 저장 블록을 모두 읽는다
function inflate(data: Uint8Array): Uint8Array {
  let pos = 0
  let bit = 0
  const out: number[] = []
  const bits = (n: number) => {
    let value = 0
    for (let i = 0; i < n; i++) {
      if (pos >= data.length) {
        throw new Error('inflate: unexpected end')
      }
      value |= ((data[pos]! >> bit) & 1) << i
      bit += 1
      if (bit === 8) {
        bit = 0
        pos += 1
      }
    }
    return value
  }
  type Huffman = { counts: number[]; symbols: number[] }
  const build = (lengths: number[]): Huffman => {
    const counts = new Array(16).fill(0)
    for (const len of lengths) {
      counts[len] += 1
    }
    counts[0] = 0
    const offsets = new Array(16).fill(0)
    for (let i = 1; i < 16; i++) {
      offsets[i] = offsets[i - 1] + counts[i - 1]
    }
    const symbols = new Array(lengths.length).fill(0)
    lengths.forEach((len, symbol) => {
      if (len !== 0) {
        symbols[offsets[len]++] = symbol
      }
    })
    return { counts, symbols }
  }
  const decode = (h: Huffman) => {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const count = h.counts[len]!
      if (code - count < first) {
        return h.symbols[index + (code - first)]!
      }
      index += count
      first += count
      first <<= 1
      code <<= 1
    }
    throw new Error('inflate: bad code')
  }
  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
    16385, 24577,
  ]
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
  const fixedLit = build([...new Array(144).fill(8), ...new Array(112).fill(9), ...new Array(24).fill(7), ...new Array(8).fill(8)])
  const fixedDist = build(new Array(30).fill(5))
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

  let isLast = 0
  while (!isLast) {
    isLast = bits(1)
    const type = bits(2)
    if (type === 0) {
      if (bit !== 0) {
        bit = 0
        pos += 1
      }
      const len = data[pos]! | (data[pos + 1]! << 8)
      pos += 4
      for (let i = 0; i < len; i++) {
        out.push(data[pos++]!)
      }
      continue
    }
    let lit = fixedLit
    let dist = fixedDist
    if (type === 2) {
      const nlen = bits(5) + 257
      const ndist = bits(5) + 1
      const ncode = bits(4) + 4
      const codeLengths = new Array(19).fill(0)
      for (let i = 0; i < ncode; i++) {
        codeLengths[ORDER[i]!] = bits(3)
      }
      const codes = build(codeLengths)
      const lengths: number[] = []
      while (lengths.length < nlen + ndist) {
        const symbol = decode(codes)
        if (symbol < 16) {
          lengths.push(symbol)
        } else if (symbol === 16) {
          const prev = lengths[lengths.length - 1] ?? 0
          for (let n = bits(2) + 3; n > 0; n--) {
            lengths.push(prev)
          }
        } else {
          for (let n = symbol === 17 ? bits(3) + 3 : bits(7) + 11; n > 0; n--) {
            lengths.push(0)
          }
        }
      }
      lit = build(lengths.slice(0, nlen))
      dist = build(lengths.slice(nlen))
    } else if (type !== 1) {
      throw new Error('inflate: bad block')
    }
    for (;;) {
      const symbol = decode(lit)
      if (symbol < 256) {
        out.push(symbol)
      } else if (symbol === 256) {
        break
      } else {
        const li = symbol - 257
        const length = LEN_BASE[li]! + bits(LEN_EXTRA[li]!)
        const di = decode(dist)
        const back = DIST_BASE[di]! + bits(DIST_EXTRA[di]!)
        const from = out.length - back
        for (let i = 0; i < length; i++) {
          out.push(out[from + i]!)
        }
      }
    }
  }
  return Uint8Array.from(out)
}

// 인터레이스 없는 PNG 를 0xRRGGBB 픽셀로 읽는다. 반 넘게 투명한 픽셀은 CLEAR 다
export function decodePng(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let width = 0
  let height = 0
  let depth = 8
  let colorType = 6
  let palette: number[] = []
  let alphas: number[] = []
  const idat: number[] = []
  while (pos < bytes.length) {
    const len = view.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    const body = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8)
      height = view.getUint32(pos + 12)
      depth = body[8]!
      colorType = body[9]!
      if (body[12] !== 0) {
        throw new Error('png: interlaced')
      }
    } else if (type === 'PLTE') {
      palette = Array.from({ length: len / 3 }, (_, i) => (body[i * 3]! << 16) | (body[i * 3 + 1]! << 8) | body[i * 3 + 2]!)
    } else if (type === 'tRNS') {
      alphas = Array.from(body)
    } else if (type === 'IDAT') {
      for (const b of body) {
        idat.push(b)
      }
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  // zlib 머리 두 바이트를 건너뛴다
  const raw = inflate(Uint8Array.from(idat).subarray(2))
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (channels === undefined || depth === 16) {
    throw new Error(`png: color type ${colorType} depth ${depth}`)
  }
  const bpp = Math.max(1, (channels * depth) / 8)
  const stride = Math.ceil((width * channels * depth) / 8)
  const lines = new Uint8Array(stride * height)
  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]!
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? lines[y * stride + x - bpp]! : 0
      const b = y > 0 ? lines[(y - 1) * stride + x]! : 0
      const c = x >= bpp && y > 0 ? lines[(y - 1) * stride + x - bpp]! : 0
      let value = raw[at++]!
      if (filter === 1) {
        value += a
      } else if (filter === 2) {
        value += b
      } else if (filter === 3) {
        value += (a + b) >> 1
      } else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      lines[y * stride + x] = value & 255
    }
  }
  const sample = (y: number, index: number) => {
    if (depth === 8) {
      return lines[y * stride + index]!
    }
    const bitAt = index * depth
    return (lines[y * stride + (bitAt >> 3)]! >> (8 - depth - (bitAt & 7))) & ((1 << depth) - 1)
  }
  const px: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb = 0
      let alpha = 255
      if (colorType === 3) {
        const i = sample(y, x)
        rgb = palette[i] ?? 0
        alpha = alphas[i] ?? 255
      } else if (colorType === 0 || colorType === 4) {
        const g = sample(y, x * channels) * (255 / ((1 << depth) - 1))
        rgb = (g << 16) | (g << 8) | g
        alpha = colorType === 4 ? sample(y, x * channels + 1) : 255
      } else {
        rgb = (sample(y, x * channels) << 16) | (sample(y, x * channels + 1) << 8) | sample(y, x * channels + 2)
        alpha = colorType === 6 ? sample(y, x * channels + 3) : 255
      }
      px.push(alpha < 128 ? CLEAR : rgb)
    }
  }
  return { width, height, px }
}

// 투명한 테두리를 잘라 낸다
export function crop(image: Pixels): Pixels {
  let [left, top, right, bottom] = [image.width, image.height, -1, -1]
  image.px.forEach((color, i) => {
    if (color !== CLEAR) {
      const x = i % image.width
      const y = Math.floor(i / image.width)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  })
  if (right < 0) {
    return { width: 1, height: 1, px: [CLEAR] }
  }
  const width = right - left + 1
  const height = bottom - top + 1
  const px: number[] = []
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      px.push(image.px[y * image.width + x]!)
    }
  }
  return { width, height, px }
}

// 이보다 어두운 색은 테두리로 본다
const OUTLINE_LUMA = 60
const lumaOf = (color: number) => ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11

// 비율을 지켜 size 안에 들어가게 줄인다. 칸마다 반 넘게 차 있으면 가장 많은 색으로 칠한다
// 큰 포켓몬을 크게 줄이면 가는 테두리가 몸 색에 묻혀 뭉개지므로, 칸에 테두리가 넉넉히 있으면 테두리를 먼저 남긴다
export function fit(image: Pixels, size: number): Pixels {
  const scale = Math.max(1, Math.max(image.width, image.height) / size)
  const width = Math.max(1, Math.round(image.width / scale))
  const height = Math.max(1, Math.round(image.height / scale))
  const px: number[] = []
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const x0 = Math.floor(tx * scale)
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * scale))
      const y0 = Math.floor(ty * scale)
      const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * scale))
      const seen = new Map<number, number>()
      let filled = 0
      let dark = 0
      let darkest = CLEAR
      for (let y = y0; y < y1 && y < image.height; y++) {
        for (let x = x0; x < x1 && x < image.width; x++) {
          const color = image.px[y * image.width + x]!
          if (color !== CLEAR) {
            filled += 1
            seen.set(color, (seen.get(color) ?? 0) + 1)
            if (lumaOf(color) < OUTLINE_LUMA) {
              dark += 1
              darkest = darkest === CLEAR || lumaOf(color) < lumaOf(darkest) ? color : darkest
            }
          }
        }
      }
      const area = (x1 - x0) * (y1 - y0)
      if (dark * 3 >= area) {
        px.push(darkest)
        continue
      }
      if (filled * 2 < area) {
        px.push(CLEAR)
        continue
      }
      // 테두리가 조금 걸친 칸은 몸 색으로 칠한다
      let best = CLEAR
      let most = 0
      for (const [color, count] of seen) {
        if (lumaOf(color) >= OUTLINE_LUMA && count > most) {
          best = color
          most = count
        }
      }
      px.push(best)
    }
  }
  return { width, height, px }
}
