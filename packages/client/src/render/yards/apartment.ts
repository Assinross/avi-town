// Набор двора многоэтажки (reference.md, раздел 3) - первый образец наборов дворов этапа 6:
// газон с живой изгородью, дорожка вдоль дома и к площадке, детская площадка (качели, горка,
// песочница), скамейки с урнами, площадка мусорных контейнеров, бельевые столбы, деревья.
// Предметы - из render/props/ (размеры в метрах, ставятся placeProp).
// Двор занимает клетку заднего ряда участка 2x2 слева от оси (u < 0); mirror = -1 - справа.

import type { GeoBuilder } from '../builder';
import type { Frame } from '../buildings';
import { PALETTE } from '../palette';
import { placeProp, type PropDef } from '../props';
import { BENCH } from '../props/bench';
import { CLOTHESLINE } from '../props/clothesline';
import { DUMPSTER } from '../props/dumpster';
import { SANDBOX } from '../props/sandbox';
import { SLIDE } from '../props/slide';
import { SWING } from '../props/swing';
import { TRASH_BIN } from '../props/trashBin';
import { roundTree } from '../streets';

/** Верх газона двора: предметы стоят на нём. */
const GROUND = 0.012;
const HEDGE = 0x55803f;

/** Куда смотрит фасад предмета в осях участка: к дому (+f), от дома (-f), вдоль улицы (+u / -u). */
type Facing = 'f' | '-f' | 'u' | '-u';

/**
 * Двор за домом в осях участка o (центр участка 2x2, f - к улице; задний ряд - f от -1 до 0).
 * v - вариант участка: выбирает варианты предметов.
 */
export function apartmentYard(g: GeoBuilder, o: Frame, v: number, mirror: 1 | -1) {
  const at = (u: number, f: number) => o.at(u * mirror, f);
  // Поворот как у GeoBuilder.box: rot = 0 - фасад к +z; к +u - на четверть оборота назад
  const turn: Record<Facing, number> = { f: 0, '-f': Math.PI, u: -Math.PI / 2 * mirror, '-u': Math.PI / 2 * mirror };
  const put = (def: PropDef, variant: number, u: number, f: number, face: Facing) => {
    const [x, z] = at(u, f);
    placeProp(g, def, variant % def.variants, x, GROUND, z, o.rot + turn[face]);
  };
  const flat = (u: number, f: number, su: number, sf: number, h: number, color: number) => {
    const [x, z] = at(u, f);
    g.box(x, 0, z, su, h, sf, color, o.rot);
  };

  // Газон, дорожка вдоль дома через весь участок и дорожка к площадке
  flat(-0.5, -0.5, 0.94, 0.94, GROUND, PALETTE.lawn);
  flat(-0.5, -0.02, 0.94, 0.07, GROUND + 0.002, PALETTE.concrete[2]);
  flat(-0.5, -0.2, 0.05, 0.3, GROUND + 0.002, PALETTE.concrete[2]);
  // Площадка с песчаным покрытием
  flat(-0.62, -0.64, 0.6, 0.5, GROUND + 0.003, PALETTE.sand);
  put(SWING, v, -0.75, -0.48, 'f');
  put(SLIDE, v, -0.42, -0.66, 'f');
  put(SANDBOX, v + 1, -0.76, -0.78, 'f');
  // Скамейки у дорожки смотрят на площадку, урны рядом
  put(BENCH, v, -0.37, -0.16, '-f');
  put(BENCH, v, -0.63, -0.16, '-f');
  put(TRASH_BIN, v, -0.25, -0.16, '-f');
  put(TRASH_BIN, v + 1, -0.75, -0.16, '-f');
  // Мусорные контейнеры на бетонной площадке у края парковки
  flat(-0.16, -0.86, 0.3, 0.16, GROUND + 0.003, PALETTE.concrete[3]);
  put(DUMPSTER, v, -0.24, -0.86, 'f');
  put(DUMPSTER, v + 3, -0.08, -0.86, 'f');
  // Бельевые столбы вдоль края площадки
  put(CLOTHESLINE, v + 1, -0.2, -0.52, 'u');
  // Живая изгородь по заднему и боковому краю, деревья вдоль неё
  flat(-0.5, -0.97, 0.94, 0.05, 0.07, HEDGE);
  flat(-0.97, -0.5, 0.05, 0.94, 0.07, HEDGE);
  for (const [u, f, salt] of [[-0.9, -0.9, 1], [-0.55, -0.92, 2], [-0.9, -0.22, 3], [-0.08, -0.3, 4]]) {
    roundTree(g, [...at(u, f)] as [number, number], GROUND, v * 13 + salt);
  }
}
