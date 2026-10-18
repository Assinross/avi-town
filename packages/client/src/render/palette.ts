// Палитра постапокалипсиса: пыльная, тёплая, с ржавчиной и ядовитыми акцентами.

export const PALETTE = {
  sky: 0xe9dcc3,
  fog: 0xe3d4b8,
  outline: 0x3b2f26,
  ground: {
    wasteland: [0xcdb48a, 0xcab087, 0xd0b88e],
    soil: [0x9fa56b, 0x9ba267, 0xa3a96f],
    contaminated: [0xa8b04a, 0xa4ad47, 0xacb44e],
    water: [0x5f7f86, 0x5f7f86, 0x617f87],
    rock: [0xa59a8c, 0xa29789, 0xa89d8f],
  },
  dirtSide: 0x8f7556,
  asphalt: 0x6b645c,
  marking: 0xe8d9a8,
  concrete: [0xb9ada0, 0xa89c8f, 0xc4b8aa, 0x9d9185],
  window: 0x3e3a37,
  planks: [0x9a7653, 0x8c6a4a, 0xa98560],
  roofRust: [0xa0522d, 0x8b4a2b, 0xb5643a, 0x7d5a46],
  door: 0x4a3426,
  trunk: 0x6e5440,
  leaves: [0x7d8f4e, 0x6f8246, 0x8a9a57],
  boulder: [0x8f877d, 0x9c9488],
  toxic: 0xc9e05a,
} as const;

export function pick<T>(list: readonly T[], variant: number): T {
  return list[variant % list.length];
}
