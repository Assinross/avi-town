// Реестр предметов render/props/: новый предмет - свой файл и одна строка в списке ниже (README.md).
// Страница ?props показывает всё отсюда: каждый предмет - ряд из всех его вариантов.

import type { PropDef } from './kit';
import { BENCH } from './bench';
import { DUMPSTER } from './dumpster';
import { TRASH_BIN } from './trashBin';
import { SWING } from './swing';
import { SLIDE } from './slide';
import { SANDBOX } from './sandbox';
import { PULLUP_BAR } from './pullupBar';
import { SHED } from './shed';
import { CLOTHESLINE } from './clothesline';
import { FLOWER_BED } from './flowerBed';
import { VAN } from './vehicles/van';

export * from './kit';

/** Предметы дворов, улиц и промзоны - на ?props стоят на газоне. */
export const PROPS: PropDef[] = [
  BENCH,
  DUMPSTER,
  TRASH_BIN,
  SWING,
  SLIDE,
  SANDBOX,
  PULLUP_BAR,
  SHED,
  CLOTHESLINE,
  FLOWER_BED,
];

/** Машины - на ?props стоят на дороге. */
export const VEHICLES: PropDef[] = [VAN];
