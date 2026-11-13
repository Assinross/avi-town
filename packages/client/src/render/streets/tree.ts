// Дерево с круглой кроной: приствольная лунка, ствол, крона из двух усечённых конусов.
// Живёт отдельно от ленты улиц, чтобы им пользовались и улицы, и кольцо, и дворы.

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';

/** Разметка и мелкие плиты: толщина над поверхностью. */
const PAINT = 0.003;
const TRUNK = 0x6e5440;
const PIT = 0x6e5c48;
const LEAVES = [0x6f9a4a, 0x638f42, 0x7aa352] as const;

const m4 = new THREE.Matrix4();

/** Детерминированное псевдослучайное 0..1 из координат и соли - только для вида. */
export const hash = (x: number, y: number, salt: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

export function roundTree(g: GeoBuilder, [x, z]: [number, number], y: number, seed: number, scale = 1) {
  const r = (0.12 + hash(seed, 1, 2) * 0.04) * scale;
  const h = (0.13 + hash(seed, 3, 4) * 0.04) * scale;
  const leaves = LEAVES[Math.floor(hash(seed, 5, 6) * LEAVES.length)];
  g.box(x, y, z, 0.08, PAINT, 0.08, PIT);
  g.cylinder(m4.makeTranslation(x, y, z), 0.016 * scale, h + r * 0.4, TRUNK, 6);
  g.cylinder(m4.makeTranslation(x, y + h, z), r * 0.55, r * 0.75, leaves, 7, leaves, r);
  g.cylinder(m4.makeTranslation(x, y + h + r * 0.75, z), r, r * 0.85, leaves, 7, leaves, r * 0.35);
}
