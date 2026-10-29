// Банда и автобой на общей карте: фигурки ростом с прохожих. Банда идёт к домам и громит их.
// Бой - живая стычка: отряд высаживается из броневика и разбегается по укрытиям (за броневик,
// углы домов, деревья, руины), враги рассыпаются у своей точки, обе стороны время от времени
// перебегают. Выстрел - вспышка у ствола и короткая пуля, попадание - искра. Исход и попадания
// решает симуляция (fight.ts), здесь только картинка: кто стреляет и в кого - из эффекта fightShot.

import * as THREE from 'three';
import { UFO_BY_ID, WASTELAND, type Cost } from '@avi/data';
import type { Fight, Fx, World } from '@avi/sim';
import { createCharacter, UNIT_HEIGHT, type CharacterHandle, type CharacterName } from './characters';
import { CIVILIAN_HEIGHT } from './civilians';

/** Бойцы и монстры чуть выше прохожих: их надо разглядеть в толпе. */
const SCALE = (CIVILIAN_HEIGHT * 1.15) / UNIT_HEIGHT;
/** Банда идёт кучкой: радиус в клетках. */
const SPREAD = 0.16;
/** Высота ствола над землёй. */
const GUN = 0.1;
/** Скорость перебежки, клеток в секунду. */
const RUN_SPEED = 0.9;

interface Figure {
  obj: THREE.Group;
  char: CharacterHandle | null;
  pos: THREE.Vector3;
  goal: THREE.Vector3;
  anim: string;
  down: boolean;
  busyUntil: number;
  /** Когда в следующий раз думать о перебежке. */
  nextMove: number;
  /** Занятое укрытие (индекс в списке точек своей стороны); -1 - нет. */
  spot: number;
  /** Куда смотреть, стоя на месте. */
  face: THREE.Vector3;
}

interface Bullet { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; hit: boolean }
interface Flash { mesh: THREE.Mesh; life: number; max: number; grow: number }
interface Floater { el: HTMLDivElement; x: number; z: number; life: number }

/** Запасная фигурка, если модели не загрузились. */
function stub(color: number): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04).translate(0, 0.08, 0), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}

const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Трофеи текстом для всплывающей надписи. */
function lootText(loot: Cost, times = 1): string {
  const parts: string[] = [];
  if (loot.money) parts.push(`+${loot.money * times} ¢`);
  if (loot.metal) parts.push(`+${loot.metal * times} металла`);
  if (loot.alloys) parts.push(`+${loot.alloys * times} сплавов`);
  if (loot.elerium) parts.push(`+${loot.elerium * times} элерия`);
  if (loot.fragments) parts.push(`+${loot.fragments * times} фрагм.`);
  return parts.join(' · ');
}

export class BandView {
  readonly group = new THREE.Group();
  private enemies: Figure[] = [];
  private squad: Figure[] = [];
  /** Отряд после боя бежит к броневику, павшие враги ещё лежат. */
  private leaving: { fig: Figure; until: number }[] = [];
  private enemyKey = '';
  private fight: Fight | null = null;
  private bandKind: 'mutants' | 'aliens' = 'mutants';
  private squadSpots: THREE.Vector3[] = [];
  private enemySpots: THREE.Vector3[] = [];
  private bullets: Bullet[] = [];
  private flashes: Flash[] = [];
  private floaters: Floater[] = [];
  private bulletGeo = new THREE.BoxGeometry(0.012, 0.012, 0.07);
  private flashGeo = new THREE.SphereGeometry(0.02, 6, 4);
  private time = 0;
  private label: HTMLDivElement;
  private labelPos = new THREE.Vector3();

  constructor(private labelLayer: HTMLElement) {
    this.label = document.createElement('div');
    this.label.className = 'site-label band';
    this.label.style.display = 'none';
    labelLayer.appendChild(this.label);
  }

  /** Где сейчас опасность для прохожих: банда в городе и место перестрелки, в клетках. */
  threats(w: World): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    if (w.fight) out.push({ x: w.fight.x / 100, z: w.fight.y / 100 });
    else if (w.band?.arrived) out.push({ x: w.band.x / 100, z: w.band.y / 100 });
    return out;
  }

  reset() {
    for (const f of [...this.enemies, ...this.squad, ...this.leaving.map((l) => l.fig)]) this.drop(f);
    this.enemies = [];
    this.squad = [];
    this.leaving = [];
    this.enemyKey = '';
    this.fight = null;
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  private make(model: CharacterName, at: THREE.Vector3): Figure {
    const obj = new THREE.Group();
    const char = createCharacter(model);
    if (char) {
      char.object.scale.multiplyScalar(SCALE);
      char.object.traverse((o) => { o.castShadow = true; });
      obj.add(char.object);
      char.loop('Idle');
    } else obj.add(stub(model === 'soldier' ? 0x55703a : 0x8a9a4a));
    obj.position.copy(at);
    this.group.add(obj);
    return { obj, char, pos: at.clone(), goal: at.clone(), anim: 'Idle', down: false, busyUntil: 0, nextMove: 0, spot: -1, face: at.clone() };
  }

  private drop(f: Figure) {
    this.group.remove(f.obj);
    f.char?.dispose();
  }

  private loop(f: Figure, anim: string) {
    if (f.down || f.anim === anim || this.time < f.busyUntil) return;
    f.anim = anim;
    f.char?.loop(anim);
  }

  // --- Укрытия --------------------------------------------------------------------------------

  /**
   * Точки укрытий у места боя. Для отряда - за броневиком и за препятствиями со стороны,
   * дальней от врага; для врагов - за препятствиями со стороны, дальней от отряда, и вокруг своей точки.
   */
  private buildSpots(w: World, enemy: THREE.Vector3, base: THREE.Vector3) {
    const solid = (x: number, z: number) => {
      const t = w.tiles[Math.floor(z) * w.size + Math.floor(x)];
      return !t || t.object === 'building' || (t.object === 'zone' && t.level > 0);
    };
    const behind = (o: THREE.Vector3, from: THREE.Vector3, d: number, side: number) => {
      const n = o.clone().sub(from).setY(0).normalize();
      const t = new THREE.Vector3(-n.z, 0, n.x);
      return o.clone().addScaledVector(n, d).addScaledVector(t, side);
    };
    const squad: THREE.Vector3[] = [];
    const foes: THREE.Vector3[] = [];
    // Броневик - главное укрытие отряда
    for (const side of [-0.14, 0, 0.14]) squad.push(behind(base, enemy, 0.2, side));
    const cx = Math.floor((enemy.x + base.x) / 2), cz = Math.floor((enemy.z + base.z) / 2);
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, z = cz + dz;
        const t = w.tiles[z * w.size + x];
        if (!t || x < 0 || z < 0 || x >= w.size || z >= w.size) continue;
        const big = t.object === 'building' || (t.object === 'zone' && t.level > 0);
        const small = t.object === 'tree' || t.object === 'ruin' || t.object === 'rubble' || t.object === 'crash';
        if (!big && !small) continue;
        const o = new THREE.Vector3(x + 0.5, 0, z + 0.5);
        const d = big ? 0.58 : 0.3;
        for (const side of big ? [-0.3, 0.3] : [0]) {
          const ps = behind(o, enemy, d, side);
          if (!solid(ps.x, ps.z) && ps.distanceTo(enemy) > 0.8 && ps.distanceTo(enemy) < 2.6 && ps.distanceTo(base) < 2.4) squad.push(ps);
          const pe = behind(o, base, d, side);
          if (!solid(pe.x, pe.z) && pe.distanceTo(enemy) < 1.3 && pe.distanceTo(base) > 0.8) foes.push(pe);
        }
      }
    }
    // Открытые места про запас: полукругом на своей стороне
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const pe = enemy.clone().add(new THREE.Vector3(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35));
      if (!solid(pe.x, pe.z)) foes.push(pe);
      const ps = behind(base, enemy, 0.25 + (k % 3) * 0.12, (k - 3.5) * 0.12);
      if (!solid(ps.x, ps.z)) squad.push(ps);
    }
    this.squadSpots = squad;
    this.enemySpots = foes;
  }

  /** Свободное укрытие своей стороны, по возможности ближе к нынешнему месту (но не то же самое). */
  private pickSpot(f: Figure, list: Figure[], spots: THREE.Vector3[]) {
    const taken = new Set(list.filter((x) => x !== f && x.spot >= 0).map((x) => x.spot));
    const free = spots.map((p, i) => i).filter((i) => !taken.has(i) && i !== f.spot);
    if (!free.length) return;
    // Из трёх ближайших - случайное: перебежки короткие, но не по кругу
    free.sort((a, b) => spots[a].distanceTo(f.pos) - spots[b].distanceTo(f.pos));
    const i = free[Math.floor(Math.random() * Math.min(3, free.length))];
    f.spot = i;
    f.goal.copy(spots[i]).add(new THREE.Vector3(between(-0.03, 0.03), 0, between(-0.03, 0.03)));
  }

  // --- Движение и стрельба ----------------------------------------------------------------------

  /** Шаг фигурки к цели: бегом, лицом по ходу; на месте - лицом к врагу. */
  private move(f: Figure, dt: number) {
    const d = f.pos.distanceTo(f.goal);
    if (!f.down && d > 0.01) {
      const step = Math.min(d, RUN_SPEED * dt);
      f.pos.addScaledVector(f.goal.clone().sub(f.pos).normalize(), step);
      this.turn(f, f.goal, dt);
      this.loop(f, 'Run');
    } else if (!f.down) {
      this.turn(f, f.face, dt);
      this.loop(f, 'Idle');
    }
    f.obj.position.copy(f.pos);
  }

  private turn(f: Figure, to: THREE.Vector3, dt: number) {
    if (Math.hypot(to.x - f.pos.x, to.z - f.pos.z) < 0.01) return;
    const yaw = Math.atan2(to.x - f.pos.x, to.z - f.pos.z);
    let diff = yaw - f.obj.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    f.obj.rotation.y += diff * Math.min(1, dt * 10);
  }

  private flash(at: THREE.Vector3, color: number, size: number, life: number) {
    const mesh = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.copy(at);
    mesh.userData.noOutline = true;
    this.group.add(mesh);
    this.flashes.push({ mesh, life, max: life, grow: size });
  }

  /** Выстрел: вспышка у ствола, пуля летит к цели. Промах - пуля уходит мимо, в землю рядом. */
  private shoot(from: Figure, to: THREE.Vector3, hit: boolean, alien: boolean) {
    if (from.down) return;
    from.char?.once('Idle_Shoot');
    from.busyUntil = this.time + 0.5;
    from.anim = '';
    from.obj.rotation.y = Math.atan2(to.x - from.pos.x, to.z - from.pos.z);
    const muzzle = from.pos.clone().setY(GUN).addScaledVector(to.clone().sub(from.pos).setY(0).normalize(), 0.06);
    this.flash(muzzle, alien ? 0x9dff6a : 0xffe08a, 2.2, 0.08);
    const end = hit ? to.clone().setY(GUN) : to.clone().add(new THREE.Vector3(between(-0.15, 0.15), 0.01, between(-0.15, 0.15)));
    const mesh = new THREE.Mesh(this.bulletGeo, new THREE.MeshBasicMaterial({ color: alien ? 0x9dff6a : 0xfff0b0 }));
    mesh.userData.noOutline = true;
    mesh.position.copy(muzzle);
    mesh.lookAt(end);
    this.group.add(mesh);
    this.bullets.push({ mesh, from: muzzle, to: end, t: 0, hit });
  }

  private onShot(fx: Extract<Fx, { type: 'fightShot' }>) {
    const shooters = fx.alien ? this.enemies : this.squad;
    const shooter = shooters[fx.from] ?? shooters[0];
    if (!shooter) return;
    // Банда бьёт по дому: пуля в стену
    if (fx.to < 0) {
      this.shoot(shooter, new THREE.Vector3(fx.toX / 100, 0.18, fx.toY / 100), true, true);
      return;
    }
    const target = (fx.alien ? this.squad : this.enemies)[fx.to];
    this.shoot(shooter, target ? target.pos : new THREE.Vector3(fx.toX / 100, 0, fx.toY / 100), fx.hit, fx.alien);
  }

  // --- Кадр -----------------------------------------------------------------------------------

  update(w: World, camera: THREE.Camera, dt: number, apc: THREE.Vector3 | null) {
    // Игровое время: на паузе фигурки и пули замирают, на ускорении - живее
    const speed = w.over || w.speed === 0 ? 0 : Math.pow(w.speed === 3 ? 4 : w.speed, 0.6);
    const gdt = dt * speed;
    this.time += gdt;
    const f = w.fight;
    const b = w.band;
    if (b) this.bandKind = b.kind;
    if (f && f !== this.fight) this.startFight(w, f, apc);
    else if (!f && this.fight) this.endFight(apc);

    // Банда вне боя: кучкой у своей точки, если её видно сквозь туман
    if (!f) {
      const seen = !!b && w.explored[Math.floor(b.y / 100) * w.size + Math.floor(b.x / 100)] === 1;
      const kinds = seen ? b!.members.map((m) => m.kind) : [];
      const key = kinds.join();
      if (key !== this.enemyKey) {
        this.enemyKey = key;
        for (const e of this.enemies) this.drop(e);
        this.enemies = kinds.map((k) => this.make(k.startsWith('Mutant') ? 'hazmat' : 'enemy', new THREE.Vector3(b!.x / 100, 0, b!.y / 100)));
      }
      if (b && this.enemies.length) {
        const target = b.target >= 0 ? new THREE.Vector3((b.target % w.size) + 0.5, 0, Math.floor(b.target / w.size) + 0.5) : null;
        this.enemies.forEach((e, k) => {
          const a = (k / this.enemies.length) * Math.PI * 2 + 0.4;
          const r = k === 0 ? 0 : SPREAD;
          e.goal.set(b.x / 100 + Math.cos(a) * r, 0, b.y / 100 + Math.sin(a) * r);
          if (target) e.face.copy(target);
          // Банда идёт шагом, а не бегом
          const d = e.pos.distanceTo(e.goal);
          e.pos.lerp(e.goal, Math.min(1, gdt * 6));
          this.turn(e, d > 0.02 ? e.goal : e.face, gdt);
          this.loop(e, d > 0.02 ? 'Walk' : 'Idle');
          e.obj.position.copy(e.pos);
        });
      }
    } else {
      this.updateFight(f, gdt);
    }

    for (const fx of w.fx) if (fx.type === 'fightShot') this.onShot(fx);
    this.updateLeaving(apc, gdt);
    this.updateShots(gdt);
    for (const fig of [...this.enemies, ...this.squad, ...this.leaving.map((l) => l.fig)]) fig.char?.update(gdt);
    this.updateLabels(w, f, camera, dt);
  }

  private startFight(w: World, f: Fight, apc: THREE.Vector3 | null) {
    this.fight = f;
    const enemy = new THREE.Vector3(f.x / 100, 0, f.y / 100);
    const base = apc ? apc.clone().setY(0) : new THREE.Vector3(f.fromX / 100, 0, f.fromY / 100);
    this.buildSpots(w, enemy, base);
    // Враги: банда остаётся на своих местах, экипаж тарелки и охрана гнезда появляются у цели
    const kinds = f.enemies.map((x) => x.kind ?? '');
    if (kinds.join() !== this.enemyKey || !this.enemies.length) {
      for (const e of this.enemies) this.drop(e);
      this.enemies = kinds.map((k) => this.make(k.startsWith('Mutant') ? 'hazmat' : 'enemy', enemy.clone()));
    }
    this.enemyKey = `fight:${kinds.join()}`;
    // Отряд высаживается из броневика и разбегается по укрытиям
    for (const s of this.squad) this.drop(s);
    this.squad = f.squad.map(() => this.make('soldier', base.clone()));
    const t = this.time;
    this.squad.forEach((s, k) => {
      this.pickSpot(s, this.squad, this.squadSpots);
      s.face.copy(enemy);
      s.nextMove = t + between(4, 8);
      s.busyUntil = t + k * 0.15; // выпрыгивают по одному
    });
    this.enemies.forEach((e) => {
      this.pickSpot(e, this.enemies, this.enemySpots);
      e.face.copy(base);
      e.nextMove = t + between(3, 7);
    });
  }

  private updateFight(f: Fight, dt: number) {
    const sides: [Figure[], typeof f.squad, THREE.Vector3[], Figure[]][] = [
      [this.squad, f.squad, this.squadSpots, this.enemies],
      [this.enemies, f.enemies, this.enemySpots, this.squad],
    ];
    for (const [figs, units, spots, foes] of sides) {
      figs.forEach((fig, k) => {
        const u = units[k];
        if (u && u.hp <= 0 && !fig.down) {
          fig.down = true;
          fig.spot = -1;
          fig.goal.copy(fig.pos);
          fig.char?.once('Death', true);
        }
        // Перебежка: время от времени в соседнее укрытие
        if (!fig.down && this.time > fig.nextMove && fig.pos.distanceTo(fig.goal) < 0.02) {
          fig.nextMove = this.time + between(4, 9);
          if (Math.random() < 0.45) this.pickSpot(fig, figs, spots);
        }
        // Смотреть на ближайшего живого врага
        let best: Figure | null = null, bestD = Infinity;
        for (const o of foes) {
          if (o.down) continue;
          const d = o.pos.distanceTo(fig.pos);
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best) fig.face.copy(best.pos);
        this.move(fig, dt);
      });
    }
  }

  /** Бой кончился: отряд бежит в броневик, павшие враги лежат, над местом - итог. */
  private endFight(apc: THREE.Vector3 | null) {
    const f = this.fight!;
    this.fight = null;
    const won = f.enemies.every((x) => x.hp <= 0);
    const home = apc ? apc.clone().setY(0) : new THREE.Vector3(f.fromX / 100, 0, f.fromY / 100);
    for (const s of this.squad) {
      s.goal.copy(home);
      s.spot = -1;
      this.leaving.push({ fig: s, until: this.time + (s.down ? 2 : 5) });
    }
    this.squad = [];
    if (won) {
      for (const e of this.enemies) this.leaving.push({ fig: e, until: this.time + 4 });
      this.enemies = [];
      this.enemyKey = '';
    } else {
      // Выжившие враги остаются бандой на своих местах; павшие лежат и исчезают
      for (const e of this.enemies) if (e.down) this.leaving.push({ fig: e, until: this.time + 4 });
      this.enemies = this.enemies.filter((e) => !e.down);
      this.enemyKey = f.enemies.filter((x) => x.hp > 0).map((x) => x.kind).join();
    }
    let text: string;
    if (!won) text = '✖ Отряд разбит';
    else if (f.target === 'band') text = `✔ Победа · ${lootText(WASTELAND.bands[this.bandKind].trophy, f.enemies.length)}`;
    else text = `✔ Победа · ${lootText(UFO_BY_ID[f.ufo ?? '']?.salvage ?? {})}`;
    const el = document.createElement('div');
    el.className = `float-text ${won ? 'win' : 'lose'}`;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    this.floaters.push({ el, x: f.x / 100, z: f.y / 100, life: 3.5 });
  }

  private updateLeaving(apc: THREE.Vector3 | null, dt: number) {
    this.leaving = this.leaving.filter((l) => {
      const fig = l.fig;
      if (!fig.down && fig.anim !== 'Death' && fig.goal.distanceTo(fig.pos) > 0.01) {
        if (apc) fig.goal.copy(apc).setY(0);
        this.move(fig, dt);
      }
      // Добежал до броневика - сел в него
      const boarded = !fig.down && fig.pos.distanceTo(fig.goal) < 0.05;
      if (boarded || this.time > l.until) {
        this.drop(fig);
        return false;
      }
      return true;
    });
  }

  private updateShots(dt: number) {
    this.bullets = this.bullets.filter((b) => {
      b.t += dt / 0.14;
      b.mesh.position.lerpVectors(b.from, b.to, Math.min(1, b.t));
      if (b.t < 1) return true;
      // Попадание - искра, промах - пыль у ног
      this.flash(b.to, b.hit ? 0xff9a40 : 0xb8a888, b.hit ? 2.6 : 1.6, b.hit ? 0.2 : 0.3);
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
      return false;
    });
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.mesh.scale.setScalar(1 + k * f.grow);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (f.life > 0) return true;
      this.group.remove(f.mesh);
      (f.mesh.material as THREE.Material).dispose();
      return false;
    });
  }

  private updateLabels(w: World, f: Fight | null, camera: THREE.Camera, dt: number) {
    const place = (el: HTMLElement, x: number, y: number, z: number, lift = 0) => {
      const p = this.labelPos.set(x, y, z).project(camera);
      const off = p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1;
      el.style.display = off ? 'none' : 'flex';
      if (!off) el.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth}px, ${((1 - p.y) / 2) * window.innerHeight - lift}px) translate(-50%, -100%)`;
    };
    // Метка над бандой или боем: видно издалека, где беда
    const b = w.band;
    if (this.enemies.length && (f || b)) {
      const alive = f ? f.enemies.filter((e) => e.hp > 0).length : b!.members.length;
      const what = f ? (f.target === 'band' ? 'Бой с бандой' : f.target === 'nest' ? 'Бой у гнезда' : 'Бой у тарелки') : b!.kind === 'aliens' ? 'Пришельцы' : 'Мутанты';
      const html = `${f ? '⚔' : '👹'}<span>${what}: ${alive}${b && !f && b.terror ? ' · страх' : ''}</span>`;
      if (this.label.innerHTML !== html) this.label.innerHTML = html;
      const c = f ? { x: f.x / 100, z: f.y / 100 } : { x: b!.x / 100, z: b!.y / 100 };
      place(this.label, c.x, 0.45, c.z);
    } else this.label.style.display = 'none';
    // Итог боя всплывает и тает
    this.floaters = this.floaters.filter((fl) => {
      fl.life -= dt;
      place(fl.el, fl.x, 0.5, fl.z, (3.5 - fl.life) * 18);
      fl.el.style.opacity = String(Math.min(1, fl.life));
      if (fl.life > 0) return true;
      fl.el.remove();
      return false;
    });
  }
}
