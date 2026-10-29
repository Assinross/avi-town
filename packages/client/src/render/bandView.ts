// Банда и автобой на общей карте: фигурки ростом с прохожих. Банда идёт к домам и громит их,
// приехавший отряд встаёт цепью у броневика и перестреливается с ней (или с экипажем тарелки,
// охраной гнезда). Позиции - из симуляции (fighterPos), выстрелы - эффекты fightShot.

import * as THREE from 'three';
import { fighterPos, type Fight, type Fighter, type Fx, type World } from '@avi/sim';
import { createCharacter, UNIT_HEIGHT, type CharacterHandle, type CharacterName } from './characters';
import { CIVILIAN_HEIGHT } from './civilians';

/** Бойцы и монстры чуть выше прохожих: их надо разглядеть в толпе. */
const SCALE = (CIVILIAN_HEIGHT * 1.15) / UNIT_HEIGHT;
/** Банда идёт кучкой: радиус в клетках. */
const SPREAD = 0.16;

interface Figure {
  obj: THREE.Group;
  char: CharacterHandle | null;
  pos: THREE.Vector3;
  anim: string;
  down: boolean;
  busyUntil: number;
}

/** Запасная фигурка, если модели не загрузились. */
function stub(color: number): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04).translate(0, 0.08, 0), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}

export class BandView {
  readonly group = new THREE.Group();
  private enemies: Figure[] = [];
  private squad: Figure[] = [];
  private enemyKey = '';
  private squadKey = '';
  private time = 0;
  private label: HTMLDivElement;
  private labelPos = new THREE.Vector3();

  constructor(labelLayer: HTMLElement) {
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
    this.sync(this.enemies, [], 'enemy');
    this.sync(this.squad, [], 'soldier');
    this.enemyKey = this.squadKey = '';
  }

  private make(model: CharacterName, color: number): Figure {
    const obj = new THREE.Group();
    const char = createCharacter(model);
    if (char) {
      char.object.scale.multiplyScalar(SCALE);
      char.object.traverse((o) => { o.castShadow = true; });
      obj.add(char.object);
      char.loop('Idle');
    } else obj.add(stub(color));
    this.group.add(obj);
    return { obj, char, pos: new THREE.Vector3(), anim: 'Idle', down: false, busyUntil: 0 };
  }

  /** Подогнать набор фигурок под список: лишние убрать, недостающие создать. */
  private sync(list: Figure[], models: CharacterName[], fallback: CharacterName) {
    while (list.length) {
      const f = list.pop()!;
      this.group.remove(f.obj);
      f.char?.dispose();
    }
    for (const m of models) list.push(this.make(m ?? fallback, m === 'soldier' ? 0x55703a : 0x8a9a4a));
  }

  private loop(f: Figure, anim: string) {
    if (f.down || f.anim === anim || this.time < f.busyUntil) return;
    f.anim = anim;
    f.char?.loop(anim);
  }

  /** Плавно к точке и лицом к цели; на ходу - шаг, на месте - стойка. */
  private place(f: Figure, x: number, z: number, faceX: number, faceZ: number, dt: number, first: boolean) {
    const to = new THREE.Vector3(x, 0, z);
    if (first) f.pos.copy(to);
    const moving = f.pos.distanceTo(to) > 0.01;
    f.pos.lerp(to, Math.min(1, dt * 6));
    f.obj.position.copy(f.pos);
    if (!f.down) {
      const yaw = Math.atan2(faceX - f.pos.x, faceZ - f.pos.z);
      let diff = yaw - f.obj.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      f.obj.rotation.y += diff * Math.min(1, dt * 8);
    }
    this.loop(f, moving ? 'Walk' : 'Idle');
  }

  private hurt(f: Figure, x: Fighter) {
    if (x.hp > 0 || f.down) return;
    f.down = true;
    f.char?.once('Death', true);
  }

  /** Выстрел: стрелок вскидывает оружие - ищем фигурку, стоящую ближе всех к началу трассера. */
  private shot(list: Figure[], fx: Extract<Fx, { type: 'fightShot' }>) {
    let best: Figure | null = null, bestD = Infinity;
    for (const f of list) {
      const d = Math.hypot(f.pos.x - fx.fromX / 100, f.pos.z - fx.fromY / 100);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best || best.down || bestD > 0.6) return;
    best.char?.once('Idle_Shoot');
    best.busyUntil = this.time + 0.6;
    best.anim = '';
  }

  update(w: World, camera: THREE.Camera, dt: number) {
    this.time += dt;
    const f: Fight | null = w.fight;
    const b = w.band;
    const explored = (x: number, y: number) => w.explored[Math.floor(y / 100) * w.size + Math.floor(x / 100)] === 1;
    // Враги: в бою - стрелки боя, иначе банда (если её видно сквозь туман)
    const enemyModel = (kind?: string): CharacterName => (kind?.startsWith('Mutant') ? 'hazmat' : 'enemy');
    const enemies = f ? f.enemies : b && explored(b.x, b.y) ? b.members.map((m) => ({ kind: m.kind, hp: m.hp })) : [];
    const eKey = `${f ? 'f' : 'b'}:${enemies.map((e) => e.kind).join()}`;
    const firstE = eKey !== this.enemyKey;
    if (firstE) {
      this.enemyKey = eKey;
      this.sync(this.enemies, enemies.map((e) => enemyModel(e.kind)), 'enemy');
    }
    const sKey = f ? `f:${f.squad.length}:${f.fromX}:${f.fromY}` : '';
    const firstS = sKey !== this.squadKey;
    if (firstS) {
      this.squadKey = sKey;
      this.sync(this.squad, f ? f.squad.map(() => 'soldier' as const) : [], 'soldier');
    }

    if (f) {
      f.enemies.forEach((x, k) => {
        const p = fighterPos(f, 'enemy', k);
        const fig = this.enemies[k];
        this.place(fig, p.x / 100, p.y / 100, f.fromX / 100, f.fromY / 100, dt, firstE);
        this.hurt(fig, x);
      });
      f.squad.forEach((x, k) => {
        const p = fighterPos(f, 'squad', k);
        const fig = this.squad[k];
        this.place(fig, p.x / 100, p.y / 100, f.x / 100, f.y / 100, dt, firstS);
        this.hurt(fig, x);
      });
    } else if (b && this.enemies.length) {
      // Банда - кучкой вокруг своей точки, лицом к дому-цели
      const tx = b.target >= 0 ? (b.target % w.size) + 0.5 : b.x / 100;
      const tz = b.target >= 0 ? Math.floor(b.target / w.size) + 0.5 : b.y / 100;
      this.enemies.forEach((fig, k) => {
        const a = (k / this.enemies.length) * Math.PI * 2 + 0.4;
        const r = k === 0 ? 0 : SPREAD;
        this.place(fig, b.x / 100 + Math.cos(a) * r, b.y / 100 + Math.sin(a) * r, tx, tz, dt, firstE);
      });
    }
    for (const fx of w.fx) {
      if (fx.type !== 'fightShot') continue;
      this.shot(fx.alien ? this.enemies : this.squad, fx);
    }
    // Анимации идут с игровым временем: на паузе фигурки замирают
    const speed = w.over ? 0 : w.speed === 0 ? 0 : 1;
    for (const fig of [...this.enemies, ...this.squad]) fig.char?.update(dt * speed);

    // Метка над бандой: видно издалека, где беда
    const show = this.enemies.length > 0 && (!!f || !!b);
    if (show) {
      const alive = enemies.filter((e) => e.hp > 0).length;
      const what = f ? (f.target === 'band' ? 'Бой с бандой' : f.target === 'nest' ? 'Бой у гнезда' : 'Бой у тарелки') : b!.kind === 'aliens' ? 'Пришельцы' : 'Мутанты';
      const html = `${f ? '⚔' : '👹'}<span>${what}: ${alive}${b && !f && b.terror ? ' · страх' : ''}</span>`;
      if (this.label.innerHTML !== html) this.label.innerHTML = html;
      const c = f ? { x: f.x / 100, z: f.y / 100 } : { x: b!.x / 100, z: b!.y / 100 };
      this.labelPos.set(c.x, 0.45, c.z).project(camera);
      const p = this.labelPos;
      const off = p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1;
      this.label.style.display = off ? 'none' : 'flex';
      if (!off) this.label.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth}px, ${((1 - p.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`;
    } else this.label.style.display = 'none';
  }
}
