// Сохранение мира: JSON с версией формата и цепочкой миграций.
// Служебные поля (changes, events, fx) не сохраняются.

import { ALIEN_BY_ID, BUILDING_BY_ID, SQUAD, TECH_BY_ID, WASTELAND } from '@avi/data';
import { DIRS, encodeLot, LOT_SHAPES } from './lots';
import { initialSquad, woundHeal } from './squad';
import { newTransit, syncTransit } from './transit';
import { settleBunker } from './wasteland';
import { migratedCampaign } from './campaign';
import { newInvasion } from './invasion';
import { newMilitary } from './military';
import { RAID_FIRST_DAY, SAVE_VERSION, emptyStats, newBudget, type World } from './world';

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

/** v7 -> v8: постоянный отряд с ранениями. Все здоровы; бойцы идущего боя становятся составом отряда. */
function migrate7to8(w: Raw): Raw {
  const soldiers = initialSquad();
  const xcom = (w.mission?.units ?? []).filter((u: Raw) => u.side === 'xcom').slice(0, soldiers.length);
  xcom.forEach((u: Raw, k: number) => {
    soldiers[k].name = String(u.name).replace(' (вы)', '');
    u.soldier = soldiers[k].id;
  });
  // Остальным - имена, которых ещё нет в составе
  const used = new Set(soldiers.slice(0, xcom.length).map((s) => s.name));
  for (const s of soldiers.slice(xcom.length)) {
    s.name = SQUAD.names.find((n) => !used.has(n)) ?? s.name;
    used.add(s.name);
  }
  w.soldiers = soldiers;
  return w;
}

/** v8 -> v9: месячный бюджет - ставка по умолчанию, пустой месяц, долга нет; деньги остаются как есть. */
function migrate8to9(w: Raw): Raw {
  w.budget = newBudget();
  w.over = null;
  return w;
}

/** v9 -> v10: недельный бюджет - ставка по умолчанию, пустая неделя, долга нет; деньги остаются как есть.
 *  Отчёт за прошлый месяц не переносим: в нём месячные суммы, для недельной панели он не годится. */
function migrate9to10(w: Raw): Raw {
  w.budget = newBudget();
  return w;
}

/** v10 -> v11: выход из бункера. Старый город уже разведан целиком, находок нет;
 *  бункер встаёт у центра города, если рядом с дорогой есть свободное место 3x3. */
function migrate10to11(w: Raw): Raw {
  w.explored = new Array(w.size * w.size).fill(1);
  w.sites = [];
  w.bunker = null;
  w.convoy = null;
  w.expeditions = [];
  w.research.archives = 0;
  if (!w.mission) settleBunker(w as World);
  return w;
}

/** v11 -> v12: тактический бой отключён - бои идут автоматически на общей карте. Бойцы без опыта,
 *  первая банда - не раньше чем через 20 дней. Незаконченный тактический бой засчитывается отступлением. */
function migrate11to12(w: Raw): Raw {
  for (const s of w.soldiers) s.xp = 0;
  const m = w.mission;
  if (m) {
    for (const u of m.units) {
      const sol = u.side === 'xcom' ? w.soldiers.find((s: Raw) => s.id === u.soldier) : undefined;
      if (sol) sol.heal = woundHeal(u.hp);
    }
    if (w.convoy) {
      w.convoy.path.reverse();
      Object.assign(w.convoy, { seg: 0, acc: 0, phase: 'back' });
    }
    w.mission = null;
  }
  w.fight = null;
  w.band = null;
  w.nextBandDay = Math.max(w.day + 20, WASTELAND.bands.firstDay);
  return w;
}

const MIGRATIONS: Record<number, (w: Raw) => Raw> = { 2: migrate2to3, 3: migrate3to4, 4: migrate4to5, 5: migrate5to6, 6: migrate6to7, 7: migrate7to8, 8: migrate8to9, 9: migrate9to10, 10: migrate10to11, 11: migrate11to12, 12: (w: Raw) => ({ ...w, transit: newTransit() }), 13: (w: Raw) => ({ ...w, roundabouts: [] }), 14: (w: Raw) => ({ ...w, campaign: migratedCampaign(w as World) }), 15: (w: Raw) => ({ ...w, campaign: w.campaign ? { ...w.campaign, opening: null } : null }), 16: (w: Raw) => ({ ...w, campaign: w.campaign ? { ...w.campaign, invasion: newInvasion() } : null }), 17: (w: Raw) => ({
  ...w, squadStance: 'balanced',
  soldiers: w.soldiers.map((s: Raw, i: number) => ({ ...s, role: (['assault', 'marksman', 'medic'] as const)[i % 3], kit: 'standard' })),
  fight: w.fight ? { ...w.fight, stance: 'balanced', focusTarget: null } : null,
}), 18: (w: Raw) => ({ ...w, military: w.civic ? null : newMilitary() }), 19: (w: Raw) => ({ ...w, journal: [] }),
  20: (w: Raw) => ({ ...w, campaign: w.campaign ? { ...w.campaign, scenario: null } : null }) };

/** Защитная загрузка: сломанный или частичный JSON не должен обрушивать интерфейс. */
export function deserialize(json: string): LoadResult {
  try {
    const file = JSON.parse(json) as SaveFile;
    if (!file || file.format !== 'avitown-save' || !file.world) return { ok: false, reason: 'bad_format' };
    if (!Number.isInteger(file.saveVersion)) return { ok: false, reason: 'bad_format' };
    if (file.saveVersion > SAVE_VERSION) return { ok: false, reason: 'too_new' };
    if (file.saveVersion < 2) return { ok: false, reason: 'too_old' };
    const source = file.world;
    // Лимит защищает от случайно испорченного размера и чрезмерной загрузки карты.
    if (!Number.isInteger(source.size) || source.size < 16 || source.size > 256 ||
        !Array.isArray(source.tiles) || source.tiles.length !== source.size * source.size ||
        source.tiles.some((tile) => !tile || typeof tile !== 'object')) {
      return { ok: false, reason: 'bad_format' };
    }

    let raw: Raw = source;
    for (let v = file.saveVersion; v < SAVE_VERSION; v++) {
      const migration = MIGRATIONS[v];
      if (!migration) return { ok: false, reason: 'too_old' };
      raw = migration(raw);
    }
    if (!Array.isArray(raw.soldiers) || !raw.resources || !raw.research ||
        !Array.isArray(raw.research.done) || !raw.budget) return { ok: false, reason: 'bad_format' };
    const world: World = {
      mission: null, fight: null, band: null, ...raw,
      civic: raw.civic ?? null,
      campaign: raw.civic ? null : (raw.campaign ?? migratedCampaign(raw as World)),
      version: SAVE_VERSION,
      stats: { ...emptyStats(), ...raw.stats },
      changes: [], events: [], fx: [],
    };
    // Неизвестная или уже завершённая технология навсегда блокировала новые исследования:
    // checkResearch считал current занятым, а simulateDay не мог завершить неизвестный ID.
    const current = world.research.current;
    const tech = typeof current === 'string' && Object.prototype.hasOwnProperty.call(TECH_BY_ID, current)
      ? TECH_BY_ID[current] : null;
    if (!tech || world.research.done.includes(tech.id)) {
      world.research.current = null;
      world.research.progress = 0;
    } else {
      world.research.progress = Number.isFinite(world.research.progress)
        ? Math.max(0, Math.trunc(world.research.progress)) : 0;
    }
    world.research.archives = Number.isFinite(world.research.archives)
      ? Math.max(0, Math.trunc(world.research.archives)) : 0;
    if (world.campaign) {
      if (!['frontier', 'salvage', 'science'].includes(world.campaign.scenario ?? '')) world.campaign.scenario = null;
      world.campaign.opening ??= null;
      world.campaign.invasion ??= newInvasion();
      const inv = world.campaign.invasion;
      if (!Number.isSafeInteger(inv.completed) || inv.completed < 0) inv.completed = 0;
      // Невалидные записи диверсий нельзя отдавать isDisrupted/expireDisruptions:
      // оба обработчика ожидают действующие главные клетки зданий.
      inv.outages = (Array.isArray(inv.outages) ? inv.outages : []).filter((o) =>
        o && Number.isInteger(o.root) && o.root >= 0 && o.root < world.tiles.length &&
        world.tiles[o.root].object === 'building' && world.tiles[o.root].root === o.root &&
        Number.isInteger(o.untilDay) && o.untilDay > world.day);
      const plan = inv.pending;
      if (plan && (!['recon', 'strike', 'landing', 'sabotage', 'assault'].includes(plan.kind) ||
          !Number.isInteger(plan.target) || plan.target < 0 || plan.target >= world.tiles.length ||
          !['city', 'housing', 'power', 'water', 'science', 'defense', 'industry'].includes(plan.targetType) ||
          !Number.isInteger(plan.arrivalDay))) {
        inv.pending = null;
      } else if (plan && !['none', 'suspected', 'confirmed'].includes(plan.intel)) {
        plan.intel = 'none';
      }
      if (!Number.isFinite(world.campaign.threat)) world.campaign.threat = 10;
      world.campaign.threat = Math.max(0, Math.min(100, Math.trunc(world.campaign.threat)));
    }
    for (const t of world.tiles) if (!t.road) t.road = 0;
    world.roundabouts ??= [];
    world.transit ??= newTransit();

    // Журнал пользовательских данных: отбрасываем невалидные записи, ограничиваем память.
    const kinds = new Set(['intel', 'combat', 'science', 'city', 'industry']);
    const severities = new Set(['info', 'warning', 'success', 'critical']);
    world.journal = (Array.isArray(world.journal) ? world.journal : [])
      .filter((e) => e && Number.isInteger(e.day) && e.day > 0 &&
        kinds.has(e.kind) && severities.has(e.severity) && typeof e.text === 'string')
      .slice(-80)
      .map((e) => ({
        day: e.day, kind: e.kind, severity: e.severity, text: e.text.slice(0, 300),
        ...(Number.isInteger(e.x) && Number.isInteger(e.y) && e.x >= 0 && e.y >= 0 &&
           e.x < world.size && e.y < world.size ? { x: e.x, y: e.y } : {}),
      }));

    world.squadStance ??= 'balanced';
    world.military = world.civic ? null : (world.military ?? newMilitary());
    if (world.military) {
      const original = world.military;
      const defaults = newMilitary();
      if (!['air', 'ground', 'science'].includes(original.doctrine ?? '')) original.doctrine = null;
      if (!Number.isInteger(original.doctrineDay) || (original.doctrineDay ?? 0) < 1) original.doctrineDay = null;
      original.produced = Math.max(0, Number.isFinite(original.produced) ? Math.trunc(original.produced) : 0);
      const stock = original.stock ?? defaults.stock;
      original.stock = {
        scope: Math.max(0, Number.isFinite(stock.scope) ? Math.trunc(stock.scope) : 0),
        armor: Math.max(0, Number.isFinite(stock.armor) ? Math.trunc(stock.armor) : 0),
        laser: Math.max(0, Number.isFinite(stock.laser) ? Math.trunc(stock.laser) : 0),
        aaCharge: Math.max(0, Number.isFinite(stock.aaCharge) ? Math.trunc(stock.aaCharge) : 0),
      };
      if (original.job && (!['scope', 'armor', 'laser', 'aaCharge'].includes(original.job.recipe) ||
          !Number.isInteger(original.job.remaining) || original.job.remaining < 1)) original.job = null;
    }
    for (const [i, s] of world.soldiers.entries()) {
      if (!s || !Number.isInteger(s.id)) return { ok: false, reason: 'bad_format' };
      // NaN/строка в heal не уменьшается в squadDay и навсегда исключает бойца из выездов.
      s.heal = Number.isFinite(s.heal) ? Math.max(0, Math.trunc(s.heal)) : 0;
      s.xp = Number.isFinite(s.xp) ? Math.max(0, Math.trunc(s.xp)) : 0;
      if (!['assault', 'marksman', 'medic'].includes(s.role)) s.role = (['assault', 'marksman', 'medic'] as const)[i % 3];
      if (!['standard', 'scope', 'armor', 'laser'].includes(s.kit)) s.kit = 'standard';
    }
    if (world.fight) {
      world.fight.stance ??= 'balanced';
      world.fight.focusTarget ??= null;
    }
    syncTransit(world);
    return { ok: true, world };
  } catch {
    // Ошибки миграции и нормализации тоже считаем плохим сохранением.
    // Клиент сохраняет резервную копию и предлагает новый город.
    return { ok: false, reason: 'bad_format' };
  }
}
