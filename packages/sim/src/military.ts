// Военная экономика: выбор направления базы, фабричные заказы и расход боеприпасов.
// Баланс находится в @avi/data. Цены списываются при оформлении, производство паузится без энергии.
import { MILITARY, BUILDING_BY_ID, type Cost } from '@avi/data';
import type { MilitaryDoctrine, MilitaryRecipe, MilitaryState, MilitaryStockItem, World } from './world';

export type MilitaryResult = 'ok' | 'peaceful_mode' | 'no_bunker' | 'not_researched' |
  'no_money' | 'no_resources' | 'no_workshop' | 'busy' | 'nothing' | 'unknown';

export function newMilitary(): MilitaryState {
  return {
    doctrine: null, doctrineDay: null, produced: 0,
    stock: { scope: 0, armor: 0, laser: 0, aaCharge: 0 }, job: null,
  };
}

function priceReason(w: World, price: Cost): MilitaryResult {
  if ((price.money ?? 0) > w.money) return 'no_money';
  if (Object.entries(price).some(([k, amount]) =>
    k !== 'money' && (w.resources[k as keyof World['resources']] ?? 0) < (amount ?? 0))) return 'no_resources';
  return 'ok';
}

function pay(w: World, price: Cost) {
  w.money -= price.money ?? 0;
  for (const [key, amount] of Object.entries(price)) {
    if (key !== 'money') w.resources[key as keyof World['resources']] -= amount ?? 0;
  }
}

export function militaryWorkshops(w: World): number {
  let count = 0;
  for (const [i, tile] of w.tiles.entries()) {
    if (tile.object === 'building' && tile.root === i && tile.def === 'workshop' &&
      tile.build === 0 && tile.powered && BUILDING_BY_ID[tile.def]?.needsPower) count++;
  }
  return count;
}

/** Переключение специализации - дорогое решение с перерывом, без скрытых автоматических бонусов. */
export function chooseDoctrine(w: World, doctrine: MilitaryDoctrine): MilitaryResult {
  const m = w.military;
  if (!m || w.civic) return 'peaceful_mode';
  if (!w.bunker) return 'no_bunker';
  if (!Object.prototype.hasOwnProperty.call(MILITARY.doctrines, doctrine)) return 'unknown';
  if (!w.research.done.includes(MILITARY.unlockTech)) return 'not_researched';
  if (m.doctrine === doctrine) return 'nothing';
  if (m.doctrineDay !== null && w.day - m.doctrineDay < MILITARY.switchCooldownDays) return 'busy';
  const price: Cost = MILITARY.doctrines[doctrine].cost;
  const reason = priceReason(w, price);
  if (reason !== 'ok') return reason;
  pay(w, price);
  m.doctrine = doctrine;
  m.doctrineDay = w.day;
  w.events.push({ type: 'militaryDoctrine', doctrine });
  w.revision++;
  return 'ok';
}

export function orderProduction(w: World, recipe: MilitaryRecipe): MilitaryResult {
  const m = w.military;
  if (!m || w.civic) return 'peaceful_mode';
  if (!Object.prototype.hasOwnProperty.call(MILITARY.recipes, recipe)) return 'unknown';
  if (m.job) return 'busy';
  const def = MILITARY.recipes[recipe];
  if (!w.research.done.includes(def.requires)) return 'not_researched';
  if (!militaryWorkshops(w)) return 'no_workshop';
  const cost: Cost = def.cost;
  const reason = priceReason(w, cost);
  if (reason !== 'ok') return reason;
  pay(w, cost);
  m.job = { recipe, remaining: def.days };
  w.events.push({ type: 'militaryOrder', recipe });
  w.revision++;
  return 'ok';
}

/** Мастерская должна работать каждый день. Временное отключение не уничтожает оплаченный заказ. */
export function militaryDay(w: World) {
  const m = w.military;
  if (!m?.job || !militaryWorkshops(w)) return;
  if (--m.job.remaining > 0) {
    w.revision++;
    return;
  }
  const def = MILITARY.recipes[m.job.recipe];
  const item = def.output as MilitaryStockItem;
  m.stock[item] += def.quantity;
  m.produced++;
  m.job = null;
  w.events.push({ type: 'militaryProduced', item, count: def.quantity });
  w.revision++;
}

/** У готового заводского комплекта нет дополнительной цены: он расходуется со склада. */
export function useProducedKit(w: World, kit: MilitaryStockItem): boolean {
  if (!w.military || !w.military.stock[kit]) return false;
  w.military.stock[kit]--;
  w.revision++;
  return true;
}

/** Одного боекомплекта хватает на весь налёт, но он нужен только при работающей ПВО. */
export function loadAACharge(w: World): boolean {
  if (!w.military?.stock.aaCharge) return false;
  const ready = w.tiles.some((t, i) =>
    t.object === 'building' && t.root === i && t.build === 0 && t.powered && !!BUILDING_BY_ID[t.def!]?.aa);
  if (!ready) return false;
  return useProducedKit(w, 'aaCharge');
}

export function doctrineBonus(w: World) {
  return w.military?.doctrine ? MILITARY.doctrines[w.military.doctrine] : null;
}
