// Директор вторжения: предсказуемые этапы угрозы, разные задачи пришельцев и саботаж.
// Все решения опираются на состояние World и его ГСЧ; не используем часы браузера.
import { BUILDING_BY_ID, INVASION } from '@avi/data';
import { bunkerRadar } from './bunker';
import { nextInt } from './rng';
import type { InvasionKind, InvasionPlan, InvasionState, InvasionTarget, World } from './world';

export const INVASION_LABELS: Record<InvasionKind, string> = {
  recon: 'Разведка',
  strike: 'Налёт',
  landing: 'Высадка',
  sabotage: 'Диверсия',
  assault: 'Штурм',
};
export const INVASION_TARGETS: Record<InvasionTarget, string> = {
  city: 'город', housing: 'жилой квартал', power: 'электростанция',
  water: 'водоснабжение', science: 'исследовательский центр',
  defense: 'система ПВО', industry: 'промышленность',
};

export function newInvasion(): InvasionState {
  return { pending: null, completed: 0, last: null, outages: [] };
}

/** Действующий радар уточняет тип миссии и её цель за несколько дней до атаки. */
function hasIntelligence(w: World): boolean {
  if (bunkerRadar(w)) return true;
  return w.tiles.some((t, i) => t.object === 'building' && t.root === i && t.powered &&
    t.build === 0 && !!BUILDING_BY_ID[t.def!]?.radar && !isDisrupted(w, i));
}

function targetKind(w: World, index: number): InvasionTarget {
  const t = w.tiles[index];
  if (t?.object === 'zone') return t.zone === 'R' ? 'housing' : 'industry';
  if (t?.object === 'building') {
    const def = BUILDING_BY_ID[t.def!];
    if (def?.power) return 'power';
    if (def?.water) return 'water';
    if (def?.aa) return 'defense';
    if (def?.research || def?.radar) return 'science';
    if (def?.category === 'industry') return 'industry';
  }
  return 'city';
}

const PRIORITY: Record<InvasionKind, Record<InvasionTarget, number>> = {
  recon:    { city: 2, housing: 2, power: 3, water: 2, science: 7, defense: 9, industry: 2 },
  strike:   { city: 1, housing: 10, power: 4, water: 4, science: 5, defense: 2, industry: 5 },
  landing:  { city: 2, housing: 10, power: 2, water: 2, science: 4, defense: 3, industry: 3 },
  sabotage: { city: 1, housing: 1, power: 12, water: 10, science: 5, defense: 9, industry: 3 },
  assault:  { city: 2, housing: 5, power: 9, water: 5, science: 10, defense: 11, industry: 6 },
};

function candidates(w: World): { index: number; kind: InvasionTarget }[] {
  const list: { index: number; kind: InvasionTarget }[] = [];
  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i];
    if (t.object === 'building' && t.root === i && t.build === 0) {
      if (BUILDING_BY_ID[t.def!]?.fixed) continue;
      list.push({ index: i, kind: targetKind(w, i) });
    } else if (t.object === 'zone' && t.level > 0 && (t.root < 0 || t.root === i)) {
      list.push({ index: i, kind: targetKind(w, i) });
    }
  }
  return list;
}

/** Приоритет целей зависит от типа операции, а не от ближайшего к НЛО здания. */
function chooseTarget(w: World, kind: InvasionKind): { index: number; type: InvasionTarget } {
  const buildings = candidates(w);
  if (!buildings.length) {
    const bunker = w.bunker?.root ?? Math.floor(w.size / 2) * w.size + Math.floor(w.size / 2);
    return { index: bunker, type: 'city' };
  }
  const cx = Math.floor(w.size / 2), cy = Math.floor(w.size / 2);
  let best = buildings[0], high = -Infinity;
  for (const target of buildings) {
    const x = target.index % w.size, y = Math.floor(target.index / w.size);
    const score = PRIORITY[kind][target.kind] * 100 - Math.floor((Math.abs(x - cx) + Math.abs(y - cy)) / 5);
    if (score > high) { best = target; high = score; }
  }
  return { index: best.index, type: best.kind };
}

/** Подстройка угрозы под уровень обороны, без накопления скрытых "читерских" бонусов. */
function chooseKind(w: World): InvasionKind {
  const c = w.campaign!;
  const director = c.invasion!;
  const scheduled = INVASION.firstOperations[director.completed];
  if (scheduled) return scheduled as InvasionKind;
  const weights: Record<InvasionKind, number> = { ...INVASION.weights };
  const hasPowerTargets = candidates(w).some((c) => ['power', 'water', 'defense', 'science'].includes(c.kind));
  if (!hasPowerTargets) weights.sabotage = 0;
  if (c.threat < INVASION.assaultMinThreat || c.phase === 'contact') weights.assault = 0;
  const aaCount = w.tiles.filter((t, i) => t.object === 'building' && t.root === i && !!BUILDING_BY_ID[t.def!]?.aa).length;
  if (aaCount >= 2) weights.sabotage += 16;
  if (c.threat >= 70) { weights.assault += 17; weights.recon = Math.max(3, weights.recon - 6); }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = nextInt(w.rng, total);
  for (const kind of Object.keys(weights) as InvasionKind[]) {
    roll -= weights[kind];
    if (roll < 0) return kind;
  }
  return 'strike';
}

/** Выбор делается один раз и сохраняется. Строительство радара может улучшить разведданные. */
export function prepareInvasion(w: World) {
  const inv = w.campaign?.invasion;
  if (!inv || w.over || (w.campaign?.opening && !w.campaign.opening.firstRaidFinished)) return;
  if (!inv.pending && w.day >= w.nextRaidDay - INVASION.warningDays) {
    const kind = chooseKind(w);
    const target = chooseTarget(w, kind);
    inv.pending = { kind, target: target.index, targetType: target.type, arrivalDay: Math.max(w.nextRaidDay, w.day), intel: 'none' };
    w.revision++;
  }
  const p = inv.pending;
  if (!p) return;
  const intel = hasIntelligence(w) ? 'confirmed' : w.day >= p.arrivalDay - INVASION.suspicionDays ? 'suspected' : 'none';
  if (intel === p.intel || intel === 'none' || (p.intel === 'confirmed' && intel === 'suspected')) return;
  p.intel = intel;
  w.events.push({ type: 'invasionWarning', kind: intel === 'confirmed' ? p.kind : null, day: p.arrivalDay });
  w.revision++;
}

export function takeInvasionPlan(w: World): InvasionPlan | null {
  const inv = w.campaign?.invasion;
  if (!inv) return null;
  const plan = inv.pending;
  inv.pending = null;
  return plan;
}

export function recordInvasion(w: World, kind: InvasionKind | undefined, result: 'repelled' | 'escaped' | 'landed') {
  const inv = w.campaign?.invasion;
  if (!inv || !kind) return;
  inv.completed++;
  inv.last = { kind, result };
  w.events.push({ type: 'invasionResult', kind, result });
  w.revision++;
}

export function isDisrupted(w: World, root: number): boolean {
  return !!w.campaign?.invasion?.outages.some((s) => s.root === root && s.untilDay > w.day);
}

/** Диверсия временно отключает одну постройку. Остальная сеть работает по обычным правилам. */
export function disruptTarget(w: World, root: number): boolean {
  const inv = w.campaign?.invasion;
  const t = w.tiles[root];
  if (!inv || !t || t.object !== 'building' || t.root !== root) return false;
  const def = BUILDING_BY_ID[t.def!];
  if (!def || (!def.power && !def.water && !def.needsPower && !def.radar && !def.aa)) return false;
  const existing = inv.outages.find((x) => x.root === root);
  if (existing) existing.untilDay = Math.max(existing.untilDay, w.day + INVASION.sabotageDays);
  else inv.outages.push({ root, untilDay: w.day + INVASION.sabotageDays });
  for (const cell of w.tiles) if (cell.object === 'building' && cell.root === root) cell.powered = false;
  w.events.push({ type: 'invasionSabotage', target: targetKind(w, root), x: root % w.size, y: Math.floor(root / w.size), days: INVASION.sabotageDays });
  w.speed = 0;
  w.revision++;
  return true;
}

/** Вернуть инфраструктуру после окончания диверсии. */
export function expireDisruptions(w: World) {
  const inv = w.campaign?.invasion;
  if (!inv || !inv.outages.length) return;
  const expired = inv.outages.filter((o) => o.untilDay <= w.day);
  if (!expired.length) return;
  inv.outages = inv.outages.filter((o) => o.untilDay > w.day);
  for (const o of expired) w.events.push({ type: 'invasionRestored', x: o.root % w.size, y: Math.floor(o.root / w.size) });
  w.revision++;
}
