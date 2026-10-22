// Туман войны и разведка пустоши: какие клетки открыты, находки под туманом и экспедиции.
// Туман отступает сам вокруг построек и радаров, дальние земли открывают экспедиции бойцов.
// Разовые находки (тайник, архив, выжившие) забираются, как только клетку разведали.

import { SQUAD, TECH_BY_ID, WASTELAND, type SiteKind } from '@avi/data';
import { Heap } from './heap';
import { nextInt } from './rng';
import { awaySoldiers, isReady, newSoldier, PERSONAL_ID, rosterCap, woundHeal } from './squad';
import { markChanged, type Expedition, type Site, type World } from './world';

const W = WASTELAND;

export const isExplored = (w: World, idx: number) => w.explored[idx] === 1;

/** Клетка разведана; за краем карты - нет. */
export function exploredAt(w: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w.size && y < w.size && w.explored[y * w.size + x] === 1;
}

/**
 * Открыть круг радиусом r вокруг (cx, cy). Новые клетки перерисовываются, находки на них
 * становятся видны, разовые - забираются. Возвращает число новых находок.
 */
export function reveal(w: World, cx: number, cy: number, r: number): number {
  let fresh = false;
  const r2 = r * r + r;
  for (let y = Math.max(0, cy - r); y <= Math.min(w.size - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w.size - 1, cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * w.size + x;
      if (w.explored[i]) continue;
      w.explored[i] = 1;
      markChanged(w, i);
      fresh = true;
    }
  }
  return fresh ? discover(w) : 0;
}

/** Находки на разведанных клетках становятся видны; разовые - сразу забираются. */
export function discover(w: World): number {
  let n = 0;
  for (const site of w.sites) {
    if (site.found || !w.explored[site.y * w.size + site.x]) continue;
    site.found = true;
    n++;
    claim(w, site);
  }
  return n;
}

/** Что дают находки при обнаружении: тайник - деньги или металл, архив - ускорение исследований, выжившие - боец. */
function claim(w: World, site: Site) {
  const reward: { money?: number; metal?: number; soldier?: string; research?: string } = {};
  switch (site.kind) {
    case 'cache':
      w.money += site.reward.money ?? 0;
      w.resources.metal += site.reward.metal ?? 0;
      Object.assign(reward, site.reward);
      site.done = true;
      break;
    case 'archive': {
      // Архив ускоряет текущее исследование, а если учёные свободны - следующее начатое
      const tech = w.research.current ? TECH_BY_ID[w.research.current] : null;
      if (tech) {
        w.research.progress += Math.floor((tech.cost * W.sites.archive.percent) / 100);
        reward.research = tech.id;
      } else w.research.archives++;
      site.done = true;
      break;
    }
    case 'survivors':
      // Выжившие идут в отряд; нет места в казарме - приносят то, что у них было
      if (w.soldiers.length < rosterCap(w)) {
        const s = newSoldier(w);
        w.soldiers.push(s);
        reward.soldier = s.name;
      } else {
        w.money += W.sites.survivors.money;
        reward.money = W.sites.survivors.money;
      }
      site.done = true;
      break;
  }
  w.events.push({ type: 'siteFound', kind: site.kind, x: site.x, y: site.y, reward });
  w.revision++;
}

/** Находка рядом с прямоугольником здания (x0, y0, size) на расстоянии не больше d клеток. */
export function siteNear(w: World, kind: SiteKind, root: number, size: number, d = 1): Site | undefined {
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  return w.sites.find((s) => s.kind === kind && !s.done && s.x >= x0 - d && s.x <= x0 + size - 1 + d && s.y >= y0 - d && s.y <= y0 + size - 1 + d);
}

/** Ядро радиоактивного пятна: строить нельзя. */
export function irradiated(w: World, x: number, y: number): boolean {
  const core = W.sites.radiation.core;
  return w.sites.some((s) => s.kind === 'radiation' && Math.abs(s.x - x) <= core && Math.abs(s.y - y) <= core);
}

// --- Экспедиции -------------------------------------------------------------------------------

/** Клетки прямой от (x0, y0) до (x1, y1) без диагональных скачков. */
export function lineCells(w: World, x0: number, y0: number, x1: number, y1: number): number[] {
  const out = [y0 * w.size + x0];
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  for (let ix = 0, iy = 0; ix < dx || iy < dy; ) {
    if ((1 + 2 * ix) * dy < (1 + 2 * iy) * dx) { x += sx; ix++; } else { y += sy; iy++; }
    out.push(y * w.size + x);
  }
  return out;
}

const STEPS: [number, number, number][] = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];

/**
 * Путь экспедиции от бункера к клетке: пешком по суше в обход воды, с шагами по диагонали -
 * почти прямо. Цель на воде - ближайший берег. Не дойти по суше - по прямой (вброд).
 */
export function expeditionPath(w: World, x: number, y: number): number[] {
  const c = bunkerCenterOf(w);
  if (!c) return [];
  const n = w.size * w.size;
  const dry = (i: number) => w.tiles[i].terrain !== 'water';
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const start = c.y * w.size + c.x;
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  // Ближайшая к цели клетка суши: на неё и идём, если сама цель - вода
  let best = start, bestD = Math.hypot(c.x - x, c.y - y);
  const done = new Uint8Array(n);
  while (heap.size) {
    const i = heap.pop()[1];
    if (done[i]) continue;
    done[i] = 1;
    const d = dist[i];
    const ix = i % w.size, iy = Math.floor(i / w.size);
    const left = Math.hypot(ix - x, iy - y);
    if (left < bestD) { bestD = left; best = i; }
    if (left === 0) break;
    for (const [dx, dy, cost] of STEPS) {
      const nx = ix + dx, ny = iy + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const ni = ny * w.size + nx;
      // Диагональ не срезает угол через воду
      if (!dry(ni) || (dx && dy && (!dry(iy * w.size + nx) || !dry(ny * w.size + ix)))) continue;
      // Небольшая тяга к цели: из равных путей выбирается более прямой
      const nd = d + cost;
      if (nd >= dist[ni]) continue;
      dist[ni] = nd;
      prev[ni] = i;
      heap.push(nd + Math.hypot(nx - x, ny - y) * 10, ni);
    }
  }
  const target = y * w.size + x;
  if (best !== target && dry(target)) return lineCells(w, c.x, c.y, x, y);
  const path = [best];
  while (prev[path[path.length - 1]] >= 0) path.push(prev[path[path.length - 1]]);
  return path.reverse();
}

/** Цена экспедиции к клетке: деньги и еда растут с длиной пути, после "Дальних маршрутов" дешевле. */
export function expeditionCost(w: World, x: number, y: number): { money: number; food: number; cells: number } {
  const E = W.expedition;
  const cells = Math.max(0, expeditionPath(w, x, y).length - 1);
  let money = E.baseCost + cells * E.costPerCell;
  if (w.research.done.includes(E.fastTech)) money = Math.floor((money * (100 - E.discount)) / 100);
  return { money, food: cells * E.foodPerCell, cells };
}

function bunkerCenterOf(w: World): { x: number; y: number } | null {
  if (!w.bunker) return null;
  const r = w.bunker.root;
  return { x: (r % w.size) + 1, y: Math.floor(r / w.size) + 1 };
}

/** Кого отправить: здоровые и свободные, личный боец игрока - последним. */
export function scoutsFor(w: World, count: number): number[] {
  const away = awaySoldiers(w);
  const free = w.soldiers.filter((s) => isReady(s) && !away.has(s.id));
  free.sort((a, b) => (a.id === PERSONAL_ID ? 1 : 0) - (b.id === PERSONAL_ID ? 1 : 0) || a.id - b.id);
  return free.slice(0, count).map((s) => s.id);
}

/** Начать экспедицию: проверки - в командах (commands.ts), здесь только сам поход. */
export function launchExpedition(w: World, x: number, y: number, soldiers: number[]): Expedition {
  const E = W.expedition;
  const fast = w.research.done.includes(E.fastTech);
  const e: Expedition = {
    id: w.expeditions.reduce((m, x) => Math.max(m, x.id), 0) + 1,
    soldiers, path: expeditionPath(w, x, y), seg: 0, acc: 0, phase: 'out',
    ticks: fast ? E.fastTicksPerCell : E.ticksPerCell,
    radius: fast ? E.farRadius : E.targetRadius,
    found: 0,
  };
  w.expeditions.push(e);
  w.revision++;
  return e;
}

/** Тик экспедиций: шаг по клетке, полоса разведки на пути туда, круг у цели, раны по возвращении. */
export function expeditionsTick(w: World) {
  if (!w.expeditions.length) return;
  for (const e of [...w.expeditions]) {
    if (++e.acc < e.ticks) continue;
    e.acc = 0;
    e.seg++;
    const cell = e.path[Math.min(e.seg, e.path.length - 1)];
    const x = cell % w.size, y = Math.floor(cell / w.size);
    if (e.phase === 'out') e.found += reveal(w, x, y, W.expedition.corridor);
    w.revision++;
    if (e.seg < e.path.length - 1) continue;
    if (e.phase === 'out') {
      e.found += reveal(w, x, y, e.radius);
      e.phase = 'back';
      e.path.reverse();
      e.seg = 0;
      continue;
    }
    // Вернулись: кто-то мог пораниться в пустоши
    let wounded = 0;
    for (const id of e.soldiers) {
      const s = w.soldiers.find((x) => x.id === id);
      if (!s || nextInt(w.rng, 100) >= W.expedition.woundChance) continue;
      s.heal = Math.max(s.heal, woundHeal(SQUAD.soldier.hp - 1 - nextInt(w.rng, 2)));
      wounded++;
    }
    w.expeditions.splice(w.expeditions.indexOf(e), 1);
    w.events.push({ type: 'expeditionBack', found: e.found, wounded });
  }
}

/** День разведки: работающие радары открывают большой круг вокруг себя. */
export function exploreDay(w: World, radars: number[]) {
  for (const root of radars) reveal(w, root % w.size, Math.floor(root / w.size), W.reveal.radar);
}
