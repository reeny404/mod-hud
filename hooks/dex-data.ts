// 1세대 도감 데이터. PokeAPI 의 pokemon-species 에서 뽑았고 바뀌지 않으니 박아 둔다
// 진화도 1세대 안에서만 한다. 2세대 이후에 생긴 진화 전 모습(피츄, 먹고자 등)과 진화형(크로뱃 등)은 없는 것으로 친다

// 알에서 나오는 종. 진화 전 모습이고 전설이 아닌 74종
export const EGG_SPECIES: readonly number[] = [
  1, 4, 7, 10, 13, 16, 19, 21, 23, 25, 27, 29, 32, 35, 37, 39, 41, 43, 46, 48, 50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 74,
  77, 79, 81, 83, 84, 86, 88, 90, 92, 95, 96, 98, 100, 102, 104, 106, 107, 108, 109, 111, 113, 114, 115, 116, 118, 120,
  122, 123, 124, 125, 126, 127, 128, 129, 131, 132, 133, 137, 138, 140, 142, 143, 147,
]

// 종마다 진화하는 다음 종. 이브이만 셋으로 갈라진다
export const EVOLUTIONS: Readonly<Record<number, readonly number[]>> = {
  1: [2], 2: [3], 4: [5], 5: [6], 7: [8], 8: [9], 10: [11], 11: [12], 13: [14], 14: [15], 16: [17], 17: [18], 19: [20],
  21: [22], 23: [24], 25: [26], 27: [28], 29: [30], 30: [31], 32: [33], 33: [34], 35: [36], 37: [38], 39: [40], 41: [42],
  43: [44], 44: [45], 46: [47], 48: [49], 50: [51], 52: [53], 54: [55], 56: [57], 58: [59], 60: [61], 61: [62], 63: [64],
  64: [65], 66: [67], 67: [68], 69: [70], 70: [71], 72: [73], 74: [75], 75: [76], 77: [78], 79: [80], 81: [82], 84: [85],
  86: [87], 88: [89], 90: [91], 92: [93], 93: [94], 96: [97], 98: [99], 100: [101], 102: [103], 104: [105], 109: [110],
  111: [112], 116: [117], 118: [119], 120: [121], 129: [130], 133: [134, 135, 136], 138: [139], 140: [141], 147: [148],
  148: [149],
}

export const LEGENDS = { articuno: 144, zapdos: 145, moltres: 146, mewtwo: 150, mew: 151 } as const

// 진화로 처음 만들면 그 새가 오는 최종 진화형. 얼음은 프리저, 전기는 썬더, 불꽃은 파이어
export const LEGEND_FINALS: Readonly<Record<144 | 145 | 146, readonly number[]>> = {
  144: [87, 91],
  145: [26, 82, 101, 135],
  146: [6, 38, 59, 78, 136],
}

// 도감이 이만큼 차면 뮤츠가 온다
export const MEWTWO_DEX = 100

export function canEvolve(species: number): boolean {
  return EVOLUTIONS[species] !== undefined
}

// 종마다 속성. 도감 번호 순서다. 원작 골드 버전(2세대) 기준이라 코일은 강철이 붙고 삐삐는 페어리가 아닌 노말이다
const TYPES: readonly string[] = [
  'GRASS/POISON', 'GRASS/POISON', 'GRASS/POISON', 'FIRE', 'FIRE', 'FIRE/FLYING', 'WATER', 'WATER', 'WATER', 'BUG',
  'BUG', 'BUG/FLYING', 'BUG/POISON', 'BUG/POISON', 'BUG/POISON', 'NORMAL/FLYING', 'NORMAL/FLYING', 'NORMAL/FLYING',
  'NORMAL', 'NORMAL', 'NORMAL/FLYING', 'NORMAL/FLYING', 'POISON', 'POISON', 'ELECTRIC', 'ELECTRIC', 'GROUND', 'GROUND',
  'POISON', 'POISON', 'POISON/GROUND', 'POISON', 'POISON', 'POISON/GROUND', 'NORMAL', 'NORMAL', 'FIRE', 'FIRE',
  'NORMAL', 'NORMAL', 'POISON/FLYING', 'POISON/FLYING', 'GRASS/POISON', 'GRASS/POISON', 'GRASS/POISON', 'BUG/GRASS',
  'BUG/GRASS', 'BUG/POISON', 'BUG/POISON', 'GROUND', 'GROUND', 'NORMAL', 'NORMAL', 'WATER', 'WATER', 'FIGHTING',
  'FIGHTING', 'FIRE', 'FIRE', 'WATER', 'WATER', 'WATER/FIGHTING', 'PSYCHIC', 'PSYCHIC', 'PSYCHIC', 'FIGHTING',
  'FIGHTING', 'FIGHTING', 'GRASS/POISON', 'GRASS/POISON', 'GRASS/POISON', 'WATER/POISON', 'WATER/POISON', 'ROCK/GROUND',
  'ROCK/GROUND', 'ROCK/GROUND', 'FIRE', 'FIRE', 'WATER/PSYCHIC', 'WATER/PSYCHIC', 'ELECTRIC/STEEL', 'ELECTRIC/STEEL',
  'NORMAL/FLYING', 'NORMAL/FLYING', 'NORMAL/FLYING', 'WATER', 'WATER/ICE', 'POISON', 'POISON', 'WATER', 'WATER/ICE',
  'GHOST/POISON', 'GHOST/POISON', 'GHOST/POISON', 'ROCK/GROUND', 'PSYCHIC', 'PSYCHIC', 'WATER', 'WATER', 'ELECTRIC',
  'ELECTRIC', 'GRASS/PSYCHIC', 'GRASS/PSYCHIC', 'GROUND', 'GROUND', 'FIGHTING', 'FIGHTING', 'NORMAL', 'POISON',
  'POISON', 'GROUND/ROCK', 'GROUND/ROCK', 'NORMAL', 'GRASS', 'NORMAL', 'WATER', 'WATER', 'WATER', 'WATER', 'WATER',
  'WATER/PSYCHIC', 'PSYCHIC', 'BUG/FLYING', 'ICE/PSYCHIC', 'ELECTRIC', 'FIRE', 'BUG', 'NORMAL', 'WATER', 'WATER/FLYING',
  'WATER/ICE', 'NORMAL', 'NORMAL', 'WATER', 'ELECTRIC', 'FIRE', 'NORMAL', 'ROCK/WATER', 'ROCK/WATER', 'ROCK/WATER',
  'ROCK/WATER', 'ROCK/FLYING', 'NORMAL', 'ICE/FLYING', 'ELECTRIC/FLYING', 'FIRE/FLYING', 'DRAGON', 'DRAGON',
  'DRAGON/FLYING', 'PSYCHIC', 'PSYCHIC',
]

// 1세대가 아닌 종은 속성을 모르는 것으로 빈 글자를 돌려준다
export function typesOf(species: number): string {
  return TYPES[species - 1] ?? ''
}
