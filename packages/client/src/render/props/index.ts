// Реестр предметов render/props/: новый предмет - свой файл и одна строка в списке ниже (README.md).
// Страница ?props показывает всё отсюда: каждый предмет - ряд из всех его вариантов.

import type { PropDef } from './kit';
import { BENCH } from './bench';
import { DUMPSTER } from './dumpster';
import { VAN } from './vehicles/van';

export * from './kit';

/** Предметы дворов, улиц и промзоны - на ?props стоят на газоне. */
export const PROPS: PropDef[] = [BENCH, DUMPSTER];

/** Машины - на ?props стоят на дороге. */
export const VEHICLES: PropDef[] = [VAN];
