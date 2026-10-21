// Сохранение мира: JSON с версией формата и цепочкой миграций.
// Служебные поля (changes, events, fx) не сохраняются.

import { ALIEN_BY_ID, BUILDING_BY_ID, SQUAD } from '@avi/data';
import { DIRS, encodeLot, LOT_SHAPES } from './lots';
import { RAID_FIRST_DAY, SAVE_VERSION, emptyStats, type World } from './world';

type Stored = Omit<World, 'changes' | 'events' | 'fx'>;

export interface SaveFile {
  format: 'avitown-save';
  saveVersion: number;
  savedAt: string;
  world: Stored;
}

export function serialize(w: World): string {
  const { changes: _c, events: _e, fx: _f, ...rest } = w;
  const file: SaveFile = { format: 'avitown-save', saveVersion: SAVE_VERSION, savedAt: new Date().toISOString(), world: rest };
  return JSON.stringify(file);
}

export type LoadResult = { ok: true; world: World } | { ok: false; reason: 'bad_format' | 'too_new' | 'too_old' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

/** v2 -> v3: генератор и насосная стали общим типом "здание", появились ресурсы, исследования, налёты. */
function migrate2to3(w: Raw): Raw {
  for (const t of w.tiles) {
    if (t.object === 'plant' || t.object === 'pump') {
      t.def = t.object;
      t.object = 'building';
      t.hp = BUILDING_BY_ID[t.def].hp;
    } else {
      t.def = null;
      t.hp = 0;
    }
  }
  w.resources = { metal: 60, alloys: 0, elerium: 0, fragments: 0 };
  w.research = { done: [], current: null, progress: 0 };
  w.raid = null;
  w.nextRaidDay = w.day + 14;
  w.crash = null;
  return w;
}

/** v3 -> v4: стройка во времени - всё, что уже стоит, считается достроенным. */
function migrate3to4(w: Raw): Raw {
  for (const t of w.tiles) t.build = 0;
  return w;
}

/** v4 -> v5: жильё и торговля - участками. Дом у дороги становится участком 1x1 первого уровня, остальное освобождается. */
function migrate4to5(w: Raw): Raw {
  const n = w.size;
  w.tiles.forEach((t: Raw, i: number) => {
    t.lot = 0;
    if (t.object !== 'zone' || !LOT_SHAPES[t.zone as 'R' | 'C']) return;
    const x = i % n, y = Math.floor(i / n);
    const dir = DIRS.findIndex(([dx, dy]) => w.tiles[(y + dy) * n + x + dx]?.object === 'road' && x + dx >= 0 && x + dx < n);
    if (t.level > 0 && dir >= 0) {
      Object.assign(t, { root: i, level: 1, build: 0, lot: encodeLot({ dir, side: 1, w: 1, d: 1 }) });
    } else Object.assign(t, { root: -1, level: 0, build: 0 });
  });
  return w;
}

/** Ёмкость магазина по оружию юнита; 0 - бесконечное оружие. Копия battle/rules.magOf - импорт оттуда дал бы цикл. */
function magOf(u: Raw): number {
  return u.side === 'xcom' ? SQUAD.soldier.mag : ALIEN_BY_ID[u.kind]?.mag ?? 4;
}

/** v5 -> v6: тактический бой - укрытия-пропсы, боезапас, наблюдение и присед. */
function migrate5to6(w: Raw): Raw {
  const m = w.mission;
  if (!m) return w;
  m.props = m.props ?? [];
  m.log = m.log ?? [];
  for (const u of m.units) {
    u.ammo = u.ammo ?? magOf(u);
    u.overwatch = false;
    u.hunkered = false;
    u.path = u.path ?? [];
    u.moveAcc = u.moveAcc ?? 0;
  }
  return w;
}

/** v6 -> v7: налёты включены и стали редкими - старый город получает паузу до первой тарелки. */
function migrate6to7(w: Raw): Raw {
  if (!w.raid) w.nextRaidDay = Math.max(w.nextRaidDay, RAID_FIRST_DAY, w.day + 60);
  return w;
}

const MIGRATIONS: Record<number, (w: Raw) => Raw> = { 2: migrate2to3, 3: migrate3to4, 4: migrate4to5, 5: migrate5to6, 6: migrate6to7 };

export function deserialize(json: string): LoadResult {
  let file: SaveFile;
  try {
    file = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'bad_format' };
  }
  if (file?.format !== 'avitown-save' || !file.world?.tiles) return { ok: false, reason: 'bad_format' };
  if (file.saveVersion > SAVE_VERSION) return { ok: false, reason: 'too_new' };
  let raw: Raw = file.world;
  for (let v = file.saveVersion; v < SAVE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) return { ok: false, reason: 'too_old' };
    raw = m(raw);
  }
  const world: World = { mission: null, ...raw, version: SAVE_VERSION, stats: { ...emptyStats(), ...raw.stats }, changes: [], events: [], fx: [] };
  return { ok: true, world };
}
