// Пустошь после войны: новая игра начинается у бункера, карта под туманом. Генератор ставит
// бункер на пригодное место (рядом вода и плодородная земля), раскладывает руины довоенных
// кварталов со старыми улицами, воронки и находки. Всё через ГСЧ мира - карта зависит от сида.

import { BUILDING_BY_ID, WASTELAND, type SiteKind } from '@avi/data';
import { newBunker } from './bunker';
import { clearTile } from './commands';
import { discover, reveal } from './explore';
import { nextInt } from './rng';
import { createWorld, tileAt, type Site, type Tile, type World } from './world';

const W = WASTELAND;
const BUNKER = 3;

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const between = (w: World, [a, b]: [number, number]) => a + nextInt(w.rng, b - a + 1);

/** Новая игра "выход из бункера": карта, бункер, руины, находки и туман. */
export function newWasteland(seed: number, size = 64): World {
  const w = createWorld(seed, size);
  w.explored.fill(0);
  const spot = findBunkerSpot(w, size / 2, size / 2, false) ?? { x: Math.floor(size / 2) - 1, y: Math.floor(size / 2) - 1 };
  placeBunker(w, spot.x, spot.y);
  const cx = spot.x + 1, cy = spot.y + 1;
  ensureStart(w, cx, cy);
  addRuins(w, cx, cy);
  addCraters(w, cx, cy);
  addSites(w, cx, cy);
  reveal(w, cx, cy, W.reveal.bunker);
  // Стартовый круг открыт без оповещений: находки рядом с бункером просто видны
  w.events.length = 0;
  w.changes.length = 0;
  return w;
}

/** Клетки площадки 3x3 пригодны под бункер: суша, не камни и не заражённая земля, без построек. */
function spotOk(w: World, x: number, y: number, needRoad: boolean): boolean {
  let road = false;
  for (let dy = 0; dy < BUNKER; dy++) {
    for (let dx = 0; dx < BUNKER; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (!t || t.terrain === 'water' || t.terrain === 'rock' || t.terrain === 'contaminated') return false;
      if (t.object !== 'none' && t.object !== 'tree') return false;
    }
  }
  if (!needRoad) return true;
  for (let dy = -1; dy <= BUNKER; dy++) {
    for (let dx = -1; dx <= BUNKER; dx++) if (tileAt(w, x + dx, y + dy)?.object === 'road') road = true;
  }
  return road;
}

/**
 * Место под бункер. На новой карте - с плодородной землёй и водой поблизости и подальше от края;
 * в старом городе (needRoad) - ближайшее к (nx, ny) свободное место у дороги.
 */
export function findBunkerSpot(w: World, nx: number, ny: number, needRoad: boolean): { x: number; y: number } | null {
  const margin = needRoad ? 1 : 12;
  let best: { x: number; y: number } | null = null, bestScore = -Infinity;
  for (let y = margin; y <= w.size - margin - BUNKER; y++) {
    for (let x = margin; x <= w.size - margin - BUNKER; x++) {
      if (!spotOk(w, x, y, needRoad)) continue;
      let score: number;
      if (needRoad) score = -dist(x + 1, y + 1, nx, ny);
      else {
        let soil = 0, water = false;
        for (let dy = -9; dy <= 9; dy++) {
          for (let dx = -9; dx <= 9; dx++) {
            const t = tileAt(w, x + 1 + dx, y + 1 + dy);
            if (t?.terrain === 'soil') soil++;
            if (t?.terrain === 'water' && Math.abs(dx) <= 8 && Math.abs(dy) <= 8) water = true;
          }
        }
        score = Math.min(soil, 60) + (water ? 40 : 0) - dist(x + 1, y + 1, nx, ny) * 0.8 + nextInt(w.rng, 20);
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Поставить здание бункера 3x3 с левым верхним углом (x, y). */
export function placeBunker(w: World, x: number, y: number) {
  const root = y * w.size + x;
  const def = BUILDING_BY_ID.bunker;
  for (let dy = 0; dy < BUNKER; dy++) {
    for (let dx = 0; dx < BUNKER; dx++) {
      const t = w.tiles[(y + dy) * w.size + x + dx];
      clearTile(t);
      if (t.terrain === 'water') t.terrain = 'wasteland';
      Object.assign(t, { object: 'building', def: def.id, root, hp: W.bunker.hp, build: 0 });
    }
  }
  // Вокруг бункера - чистая площадка: к нему можно сразу провести дорогу
  for (let dy = -1; dy <= BUNKER; dy++) {
    for (let dx = -1; dx <= BUNKER; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (t?.object === 'tree') t.object = 'none';
    }
  }
  w.bunker = newBunker(root);
}

/** Старт не тупиковый: рядом с бункером есть плодородная земля и вода (река или источник). */
function ensureStart(w: World, cx: number, cy: number) {
  let soil = 0, water = false;
  for (let dy = -9; dy <= 9; dy++) {
    for (let dx = -9; dx <= 9; dx++) {
      const t = tileAt(w, cx + dx, cy + dy);
      if (t?.terrain === 'soil') soil++;
      if (t?.terrain === 'water') water = true;
    }
  }
  if (soil < 25) {
    // Плодородная долина в 4-7 клетках от бункера
    const a = nextInt(w.rng, 360) * (Math.PI / 180), r = 4 + nextInt(w.rng, 4);
    blob(w, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 3, (t) => { t.terrain = 'soil'; });
  }
  if (!water) {
    const spot = freeCell(w, cx, cy, 3, 6, 50);
    if (spot) pushSite(w, 'spring', spot.x, spot.y);
  }
}

/** Изменить сушу без построек в круге радиусом r. */
function blob(w: World, x: number, y: number, r: number, f: (t: Tile) => void) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + r) continue;
      const t = tileAt(w, x + dx, y + dy);
      if (!t || t.terrain === 'water' || (t.object !== 'none' && t.object !== 'tree' && t.object !== 'rubble')) continue;
      f(t);
    }
  }
}

/** Случайная свободная клетка суши на расстоянии rMin..rMax от (cx, cy). */
function freeCell(w: World, cx: number, cy: number, rMin: number, rMax: number, tries: number): { x: number; y: number } | null {
  for (let k = 0; k < tries; k++) {
    const x = 2 + nextInt(w.rng, w.size - 4), y = 2 + nextInt(w.rng, w.size - 4);
    const d = dist(x, y, cx, cy);
    if (d < rMin || d > rMax) continue;
    const t = tileAt(w, x, y)!;
    if (t.terrain === 'water' || (t.object !== 'none' && t.object !== 'tree')) continue;
    if (w.sites.some((s) => Math.abs(s.x - x) < 4 && Math.abs(s.y - y) < 4)) continue;
    return { x, y };
  }
  return null;
}

function pushSite(w: World, kind: SiteKind, x: number, y: number) {
  const site: Site = { id: w.sites.length + 1, x, y, kind, found: false, done: false, reward: {} };
  const S = W.sites;
  switch (kind) {
    case 'cache':
      if (nextInt(w.rng, 2)) site.reward.money = between(w, S.cache.money);
      else site.reward.metal = between(w, S.cache.metal);
      break;
    // Залежь - камни под шахту 2x2, источник - плодородный берег под насосную
    case 'metal': blob(w, x, y, 1, (t) => { t.terrain = 'rock'; t.object = 'none'; }); break;
    case 'spring': blob(w, x, y, 1, (t) => { t.terrain = 'soil'; t.object = 'none'; }); break;
    case 'radiation': blob(w, x, y, S.radiation.radius, (t) => { t.terrain = 'contaminated'; }); break;
    case 'nest': blob(w, x, y, 1, (t) => { t.object = 'none'; }); break;
  }
  w.sites.push(site);
}

/** Находки пустоши: подальше от бункера, не друг на друге. */
function addSites(w: World, cx: number, cy: number) {
  const order: SiteKind[] = ['metal', 'spring', 'cache', 'archive', 'survivors', 'radiation', 'nest'];
  for (const kind of order) {
    for (let k = 0; k < W.sites.count[kind]; k++) {
      const spot = freeCell(w, cx, cy, W.sites.minDistance, w.size * 2, 300);
      if (spot) pushSite(w, kind, spot.x, spot.y);
    }
  }
}

/** Довоенные кварталы: сетка старых улиц (часть разрушена), между ними руины и завалы. */
function addRuins(w: World, cx: number, cy: number) {
  const R = W.ruins;
  const n = between(w, R.districts);
  for (let k = 0; k < n; k++) {
    const s = between(w, R.size);
    let x0 = 0, y0 = 0, ok = false;
    for (let tries = 0; tries < 60 && !ok; tries++) {
      x0 = 2 + nextInt(w.rng, w.size - s - 4);
      y0 = 2 + nextInt(w.rng, w.size - s - 4);
      ok = dist(x0 + s / 2, y0 + s / 2, cx, cy) > 16;
    }
    if (!ok) continue;
    for (let y = y0; y < y0 + s; y++) {
      for (let x = x0; x < x0 + s; x++) {
        const t = w.tiles[y * w.size + x];
        if (t.terrain === 'water' || t.object === 'building') continue;
        t.object = 'none';
        if (t.terrain === 'soil') t.terrain = 'wasteland';
        const street = (x - x0) % R.roadEvery === 0 || (y - y0) % R.roadEvery === 0;
        if (street) t.object = nextInt(w.rng, 100) < R.roadKeep ? 'road' : 'rubble';
        else if (nextInt(w.rng, 100) < R.ruinChance) t.object = 'ruin';
        else if (nextInt(w.rng, 100) < 25) t.object = 'rubble';
      }
    }
  }
}

/** Воронки от взрывов: завалы в центре, заражённая земля вокруг. */
function addCraters(w: World, cx: number, cy: number) {
  const n = between(w, W.ruins.craters);
  for (let k = 0; k < n; k++) {
    const spot = freeCell(w, cx, cy, 12, w.size * 2, 100);
    if (!spot) continue;
    const r = 1 + nextInt(w.rng, 2);
    blob(w, spot.x, spot.y, r, (t) => { t.terrain = 'contaminated'; if (t.object === 'tree') t.object = 'none'; });
    const c = tileAt(w, spot.x, spot.y)!;
    if (c.terrain !== 'water') c.object = 'rubble';
  }
}

/** Старый город при загрузке: бункер у центра города, если есть свободное место у дороги. */
export function settleBunker(w: World) {
  let sx = 0, sy = 0, n = 0;
  w.tiles.forEach((t, i) => {
    if (t.object === 'building' || (t.object === 'zone' && t.level > 0)) {
      sx += i % w.size;
      sy += Math.floor(i / w.size);
      n++;
    }
  });
  const c = n ? { x: sx / n, y: sy / n } : { x: w.size / 2, y: w.size / 2 };
  const spot = findBunkerSpot(w, c.x, c.y, true);
  if (spot) placeBunker(w, spot.x, spot.y);
  discover(w);
}
