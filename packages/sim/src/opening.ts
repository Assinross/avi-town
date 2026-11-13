// Первые минуты кампании: сигнал, выбор игрока, найденное крушение и разведывательный налёт.
// Только состояние мира и существующий ГСЧ: событие повторяемо по сиду и сохраняется.
import { WASTELAND } from '@avi/data';
import { bunkerCenter } from './bunker';
import { campaignContact } from './campaign';
import { clearTile } from './commands';
import { reveal } from './explore';
import { markChanged, type OpeningChoice, type OpeningState, type World } from './world';

export function newOpening(): OpeningState {
  return {
    choice: null, wreckLocated: false, firstRaidWarned: false,
    firstRaidStarted: false, firstRaidFinished: false, researchStarted: false, complete: false,
  };
}

/** Одно решение на старте. Бонусы нельзя получить дважды или отменить через Ctrl+Z. */
export function chooseOpening(w: World, choice: Exclude<OpeningChoice, 'none'>): boolean {
  const o = w.campaign?.opening;
  if (!o || o.choice !== null || w.day >= 10 || w.over) return false;
  o.choice = choice;
  if (choice === 'recon') {
    // Архив ускорит первое запущенное исследование, а наблюдение даст раннюю тревогу.
    w.research.archives++;
  } else {
    // Ресурсы на раннюю ПВО; одноразовая огневая точка бункера действует только в первый налёт.
    w.resources.metal += 20;
    w.money += 1500;
  }
  w.events.push({ type: 'openingChoice', choice });
  w.revision++;
  return true;
}

/** Подобрать ближайшую безопасную клетку, не занятые игроком постройки не трогаем. */
function wreckCell(w: World): { x: number; y: number } | null {
  const c = bunkerCenter(w);
  if (!c) return null;
  let best: { x: number; y: number } | null = null;
  let score = Infinity;
  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i];
    if (!['wasteland', 'soil'].includes(t.terrain) || !['none', 'tree', 'rubble'].includes(t.object)) continue;
    const x = i % w.size, y = Math.floor(i / w.size);
    const d = Math.abs(x - c.x) + Math.abs(y - c.y);
    if (d < 5 || d > 13 || w.sites.some((s) => s.x === x && s.y === y && !s.done)) continue;
    const value = Math.abs(d - 7) * 100 + Math.abs(x - c.x) + Math.abs(y - c.y);
    if (value < score) { score = value; best = { x, y }; }
  }
  return best;
}

/** Раннее крушение уже повреждённого разведчика, независимое от случайных обычных налётов. */
function locateWreck(w: World): boolean {
  const o = w.campaign?.opening;
  if (!o || o.wreckLocated || w.crash || w.raid) return false;
  const p = wreckCell(w);
  if (!p) return false;
  const idx = p.y * w.size + p.x;
  const t = w.tiles[idx];
  clearTile(t);
  t.object = 'crash';
  t.def = 'smallScout';
  w.crash = { x: p.x, y: p.y, ufo: 'smallScout', expiresDay: w.day + 22, opening: true };
  o.wreckLocated = true;
  markChanged(w, idx);
  campaignContact(w);
  reveal(w, p.x, p.y, WASTELAND.reveal.crash);
  w.events.push({ type: 'openingWreck', x: p.x, y: p.y });
  w.speed = 0;
  w.revision++;
  return true;
}

export function openingResearchStarted(w: World) {
  const o = w.campaign?.opening;
  if (!o || o.researchStarted) return;
  o.researchStarted = true;
  w.revision++;
}

export function openingRaidStarted(w: World) {
  const o = w.campaign?.opening;
  if (!o || o.firstRaidStarted) return;
  o.firstRaidStarted = true;
  w.events.push({ type: 'openingRaid' });
  w.revision++;
}

export function openingRaidFinished(w: World) {
  const o = w.campaign?.opening;
  if (!o || o.firstRaidFinished) return;
  o.firstRaidFinished = true;
  w.events.push({ type: 'openingRaidFinished' });
  w.revision++;
}

/** Вызывается ежедневно после подсчёта экономики, перед проверкой налётов. */
export function openingDay(w: World) {
  const o = w.campaign?.opening;
  if (!o || w.over || o.complete) return;
  if (o.choice === null && w.day >= 10) {
    // Не блокируем игру при пропуске выбора, но бонусы уже недоступны.
    o.choice = 'none';
    w.revision++;
  }
  const wreckDay = o.choice === 'recon' ? 7 : 10;
  if (!o.wreckLocated && w.day >= wreckDay) locateWreck(w);
  const warningDay = o.choice === 'recon' ? 18 : 22;
  if (!o.firstRaidWarned && w.day >= warningDay && !o.firstRaidStarted) {
    o.firstRaidWarned = true;
    w.events.push({ type: 'openingWarning', day: w.nextRaidDay });
    w.speed = 0;
    w.revision++;
  }
  if (o.firstRaidFinished && o.researchStarted && (w.campaign!.wrecksCleared + w.campaign!.nestsCleared > 0)) {
    o.complete = true;
    w.events.push({ type: 'openingComplete' });
    w.revision++;
  }
}
