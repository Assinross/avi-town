// Наборы дворов участков (plan.md 010, этап 6) по образцу двора многоэтажки (apartment.ts):
// задний двор двухэтажного дома R2 - детский уголок, огород с сараем или патио с клумбами;
// сквер торговли C3 у улицы - плитка, клумбы, скамейки, урны, деревья.
// Клетка двора в своих осях o: центр клетки, f - к дому (у R2) или к улице (у сквера).

import type { GeoBuilder } from '../builder';
import type { Frame } from '../buildings';
import { NATURE, type NatureName } from '../models';
import { PALETTE, pick } from '../palette';
import { placeProp, type PropDef } from '../props';
import { BENCH } from '../props/bench';
import { CLOTHESLINE } from '../props/clothesline';
import { FLOWER_BED } from '../props/flowerBed';
import { PULLUP_BAR } from '../props/pullupBar';
import { SANDBOX } from '../props/sandbox';
import { SHED } from '../props/shed';
import { SWING } from '../props/swing';
import { TRASH_BIN } from '../props/trashBin';
import { roundTree } from '../streets';

const GROUND = 0.012;
const VEGGIES: NatureName[] = ['crop_pumpkin', 'crop_carrot', 'crop_turnip', 'crops_leafsStageB', 'crop_melon'];

type Facing = 'f' | '-f' | 'u' | '-u';
const TURN: Record<Facing, number> = { f: 0, '-f': Math.PI, u: -Math.PI / 2, '-u': Math.PI / 2 };

/** Набор для клетки: предмет, плоская заливка, дерево; mirror - зеркально по u. */
function kit(g: GeoBuilder, o: Frame, mirror: number) {
  const at = (u: number, f: number) => o.at(u * mirror, f);
  const put = (def: PropDef, variant: number, u: number, f: number, face: Facing) => {
    const [x, z] = at(u, f);
    const turn = face === 'u' || face === '-u' ? TURN[face] * mirror : TURN[face];
    placeProp(g, def, variant % def.variants, x, GROUND, z, o.rot + turn);
  };
  const flat = (u: number, f: number, su: number, sf: number, h: number, color: number) => {
    const [x, z] = at(u, f);
    g.box(x, 0, z, su, h, sf, color, o.rot);
  };
  const tree = (u: number, f: number, seed: number, scale = 1) => roundTree(g, [...at(u, f)] as [number, number], GROUND, seed, scale);
  return { at, put, flat, tree };
}

/** Задний двор R2 на клетке за домом (дом - в сторону +f, забор рисует cityMesh). */
export function houseYard(g: GeoBuilder, o: Frame, v: number) {
  const mirror = v & 4 ? -1 : 1;
  const { at, put, flat, tree } = kit(g, o, mirror);
  flat(0, 0, 0.92, 0.92, GROUND, PALETTE.lawn);
  // Дорожка от задней двери вглубь
  flat(0.1, 0.22, 0.08, 0.48, GROUND + 0.002, PALETTE.concrete[2]);
  switch (v % 3) {
    case 0: { // детский уголок: песок, качели и песочница, скамейка для взрослых, клумба у дома
      flat(-0.2, -0.15, 0.48, 0.5, GROUND + 0.003, PALETTE.sand);
      put(SWING, v, -0.2, -0.28, 'f');
      put(SANDBOX, v, -0.25, 0.0, 'f');
      put(BENCH, v, 0.3, -0.05, 'u');
      put(FLOWER_BED, v, 0.3, 0.36, 'f');
      put(CLOTHESLINE, v, 0.25, -0.34, 'u');
      tree(0.35, -0.36, v * 7 + 1);
      break;
    }
    case 1: { // огород: грядки, сарай в углу, бельё, яблоня
      const crop = pick(VEGGIES, v >> 1);
      for (let r = 0; r < 3; r++) {
        const u = -0.32 + r * 0.16;
        flat(u, -0.12, 0.1, 0.46, 0.016, PALETTE.dirtSide);
        for (let i = 0; i < 3; i++) {
          const [x, z] = at(u, -0.3 + i * 0.17);
          g.model(NATURE[crop], x, 0.012, z, 0.2, o.rot + ((v + r + i) % 4) * (Math.PI / 2));
        }
      }
      put(SHED, v, 0.28, -0.3, 'f');
      put(CLOTHESLINE, v + 1, -0.15, 0.3, 'u');
      put(TRASH_BIN, v, 0.36, 0.36, '-u');
      tree(0.3, 0.12, v * 7 + 2, 0.9);
      break;
    }
    default: { // патио: плитка у дома, скамейки друг напротив друга, клумбы, турник, сарай
      flat(-0.12, 0.22, 0.56, 0.4, GROUND + 0.003, PALETTE.concrete[0]);
      put(BENCH, v, -0.3, 0.24, 'u');
      put(BENCH, v + 2, 0.06, 0.24, '-u');
      put(FLOWER_BED, v, -0.12, 0.38, 'f');
      put(FLOWER_BED, v + 1, -0.3, -0.05, 'u');
      put(PULLUP_BAR, v, 0.05, -0.2, 'f');
      put(SHED, v + 1, -0.25, -0.32, 'f');
      tree(0.34, -0.34, v * 7 + 3);
      tree(0.36, 0.05, v * 7 + 4, 0.85);
    }
  }
}

/** Сквер торговли на клетке у улицы (f - к улице): плитка, клумбы по центру, скамейки по краям, деревья. */
export function shopPlaza(g: GeoBuilder, o: Frame, v: number) {
  const { put, flat, tree } = kit(g, o, 1);
  flat(0, 0, 0.94, 0.94, GROUND, PALETTE.concrete[2]);
  // Газоны по углам, плитка крестом между ними
  for (const [u, f] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    flat(u * 0.27, f * 0.27, 0.3, 0.3, GROUND + 0.004, PALETTE.lawn);
    tree(u * 0.29, f * 0.29, v * 11 + u * 3 + f, 0.95);
  }
  flat(0, 0, 0.2, 0.2, GROUND + 0.006, PALETTE.concrete[3]);
  put(FLOWER_BED, v, 0, 0, 'f');
  // Скамейки вдоль дорожек лицом к клумбе, урны рядом
  put(BENCH, v, 0, 0.3, '-f');
  put(BENCH, v + 1, 0, -0.3, 'f');
  put(BENCH, v + 2, 0.3, 0, '-u');
  put(BENCH, v + 3, -0.3, 0, 'u');
  put(TRASH_BIN, v, 0.12, 0.33, '-f');
  put(TRASH_BIN, v + 1, -0.12, -0.33, 'f');
}
