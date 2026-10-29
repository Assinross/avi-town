// Сцена: свет, тени, участки карты 16x16 (перестраиваются только изменённые),
// подсветка инструмента и слои (ток, вода, грязь, услуги).

import * as THREE from 'three';
import { builtLevel, CELLS, cityEnv, SPEED_FACTOR, type World } from '@avi/sim';
import { BUILDING_BY_ID } from '@avi/data';
import { buildChunkGeometry, bunkerFace } from './cityMesh';
import type { LightAnchor } from './nightPlan';
import { CityMap } from './cityMap';
import { DayCycle, skyAt } from './dayCycle';
import { FogView } from './fogView';
import { NightLights } from './nightLights';
import { Pedestrians, type Blast } from './pedestrians';
import { CIVILIAN_NAMES } from './civilians';
import { OutlineRenderer } from './outline';
import { PALETTE } from './palette';
import { RaidView } from './raidView';
import { RoadSigns } from './roadSigns';
import { Searchlight } from './searchlight';
import { TacticalView } from './tacticalView';
import { Traffic } from './traffic';
import { WastelandView } from './wastelandView';
import { BandView } from './bandView';
import { SPRITES, SpriteLayer, type Figure } from './sprites/spriteLayer';
import type { PersonKind } from './sprites/art';
import { fxFlags, HIGH_QUALITY, type QualityProfile } from '../platform/device';

const CHUNK = 16;
// Свет: прохладное небо подсвечивает тени, тёплое солнце - освещённые стены
const HEMI = 2.7, SUN = 2.6, SUN_COLOR = 0xffd9a8;
// Бой: ночь, луна вместо солнца, свет пожара у места падения
const NIGHT_SKY = 0x131d2e, NIGHT_HEMI = 0x3a5378, NIGHT_GROUND = 0x14161d, MOON = 0x9dbde8;
// Сутки в городе: к ночи темнеет сильно - город виден островками света фонарей и окон,
// но силуэты домов и дороги остаются читаемыми
const CITY_NIGHT = 0.85;
// Каким становится свет к полной темноте: луна вместо солнца, тени - от неба
const NIGHT_HEMI_LEVEL = 1.15, NIGHT_SUN_LEVEL = 0.45;
// Тёплый свет неба: вечером золотой, на рассвете розовый; солнце у горизонта - оранжевое
const EVENING_SKY = 0xffc27a, DAWN_SKY = 0xffb8b0, LOW_SUN = 0xff8a4a;
export type Overlay = 'none' | 'power' | 'water' | 'pollution' | 'services';
// Слои грязи и услуг: источник - жёлтый, жильё без услуг - красный
const SOURCE = 0xffd66b, NO = 0xff4d4d;
// Рисованные спрайты (?sprites): тон дня (тёплый, как на макете), заката и ночи - множитель рисунка, как свет у 3D
const SPRITE_DAY = new THREE.Color(1.06, 0.97, 0.84), SPRITE_DUSK = new THREE.Color(1.0, 0.82, 0.66), SPRITE_NIGHT = new THREE.Color(0.15, 0.19, 0.33);
const SMOG = 0xff8a3d, TOXIC = 0xa64dff, SCHOOL = 0x4fc3ff, CLINIC = 0xff7ac8, BOTH = 0x5be38a;

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private outline: OutlineRenderer;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private chunks: THREE.Mesh[] = [];
  // Огни каждого участка: собираются при сборке геометрии, ночью становятся слоем света
  private chunkLights: LightAnchor[][] = [];
  private dirty = new Set<number>();
  private perRow: number;
  private preview: THREE.InstancedMesh;
  private overlayMesh: THREE.InstancedMesh;
  private overlayRevision = -1;
  private overlayMode: Overlay = 'none';
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();
  private raidView = new RaidView();
  private map = new CityMap();
  private traffic: Traffic;
  private signs: RoadSigns;
  private pedestrians: Pedestrians;
  private nightLights: NightLights;
  private searchlight: Searchlight;
  private fogView: FogView;
  private wasteland: WastelandView;
  private band: BandView;
  /** Прототип рисованной графики 009: null - обычная 3D-графика. */
  private sprites: SpriteLayer | null = SPRITES ? new SpriteLayer() : null;
  private spriteTint = new THREE.Color();
  readonly tactical: TacticalView;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private daySky = new THREE.Color(PALETTE.sky);
  private duskSky = new THREE.Color(0x5b4a63);
  private nightSky = new THREE.Color(NIGHT_SKY);
  private moonColor = new THREE.Color(MOON);
  private fog: THREE.Fog;
  private fire: THREE.PointLight;
  private night = 0;
  private time = 0;
  private blasts: Blast[] = [];
  /** Куда смотрят ворота бункера: дорогу провели с другой стороны - бункер перерисовывается. */
  private bunkerFace = -1;
  /** Видимые сутки: смена дня и ночи отвязана от игровых дней, это только картинка. */
  readonly cycle = new DayCycle();

  constructor(canvas: HTMLCanvasElement, private world: World, labelLayer: HTMLElement, quality: QualityProfile = HIGH_QUALITY) {
    this.tactical = new TacticalView(labelLayer);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
    // ?fx=-shadows - сравнение вида и стоимости эффектов
    this.renderer.shadowMap.enabled = fxFlags.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.outline = new OutlineRenderer(this.renderer);
    this.outline.setBloom(quality.nightBloom && fxFlags.bloom);
    // У рисованных спрайтов контура нет по Style Bible: светлая кромка и тень вместо линии
    this.outline.setOutline(fxFlags.outline && !this.sprites);
    this.nightLights = new NightLights(this.scene, quality);
    this.searchlight = new Searchlight(quality);
    this.scene.add(this.searchlight.group);

    this.scene.background = new THREE.Color(PALETTE.sky);
    this.fog = new THREE.Fog(PALETTE.fog, 400, 900);
    this.scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xe2ecff, 0xc2ad8c, HEMI);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(SUN_COLOR, SUN);
    this.sun = sun;
    const s = world.size;
    sun.position.set(s * 0.5 - 30, 60, s * 0.5 - 20);
    sun.target.position.set(s / 2, 0, s / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    Object.assign(sun.shadow.camera, { left: -s * 0.75, right: s * 0.75, top: s * 0.75, bottom: -s * 0.75, far: 200 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.intensity = 0.8;
    this.scene.add(sun, sun.target);

    // Пожар у места падения: разгорается только ночью, в бою
    this.fire = new THREE.PointLight(0xff8a3a, 0, 6, 2);
    this.scene.add(this.fire);

    this.perRow = Math.ceil(s / CHUNK);
    for (let i = 0; i < this.perRow * this.perRow; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.chunks.push(mesh);
      this.dirty.add(i);
    }

    const quad = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    this.preview = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), s * s);
    this.preview.count = 0;
    this.preview.renderOrder = 2;
    // Границы набора считаются один раз, пока он пуст, - без этого он навсегда отсекается
    this.preview.frustumCulled = false;
    this.preview.userData.noOutline = true;
    this.scene.add(this.preview);
    this.overlayMesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), s * s);
    this.overlayMesh.count = 0;
    this.overlayMesh.renderOrder = 1;
    this.overlayMesh.frustumCulled = false;
    this.overlayMesh.userData.noOutline = true;
    this.scene.add(this.overlayMesh);
    this.scene.add(this.raidView.group);
    this.scene.add(this.tactical.group);
    this.traffic = new Traffic(this.map, quality.maxCars);
    // С рисованными спрайтами машины - картинки, 3D-модели только едут
    if (!this.sprites) this.scene.add(this.traffic.group);
    this.signs = new RoadSigns();
    this.scene.add(this.signs.group);
    this.pedestrians = new Pedestrians(this.map, quality.maxPeople);
    this.pedestrians.setTraffic(this.traffic);
    this.traffic.onCrossing = (cell) => this.pedestrians.onCrossing(cell);
    // С рисованными спрайтами люди - картинки, 3D-модели только считают путь
    if (this.sprites) this.scene.add(this.sprites.group);
    else this.scene.add(this.pedestrians.group);
    this.fogView = new FogView(s);
    this.scene.add(this.fogView.group);
    this.wasteland = new WastelandView(labelLayer);
    this.wasteland.spriteApc = !!this.sprites;
    this.scene.add(this.wasteland.group);
    this.band = new BandView(labelLayer);
    this.scene.add(this.band.group);
    // Броневик едет с мигалкой: машины на его клетках останавливаются
    this.traffic.onConvoy = (cell) => this.wasteland.convoyCells(this.world).includes(cell);
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.outline.setSize(w, h);
  }

  /** Качество из настроек: разрешение рендера, карта теней и ночное свечение применяются сразу. */
  setQuality(q: QualityProfile) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    // Карта теней пересоздаётся под новым размером: иначе осталась старая
    if (this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.outline.setBloom(q.nightBloom && fxFlags.bloom);
  }

  /** Подсветка клеток под инструментом: голубая - можно, красная - нельзя, жёлтая - радиус действия. */
  setPreview(cells: { x: number; y: number; ok: boolean; area?: boolean }[]) {
    this.preview.count = cells.length;
    cells.forEach((c, i) => {
      this.tmp.position.set(c.x + 0.5, 0.08, c.y + 0.5);
      this.tmp.updateMatrix();
      this.preview.setMatrixAt(i, this.tmp.matrix);
      this.preview.setColorAt(i, this.color.setHex(c.area ? 0xffd66b : c.ok ? 0x4fc3ff : 0xff4d4d));
    });
    this.preview.instanceMatrix.needsUpdate = true;
    if (this.preview.instanceColor) this.preview.instanceColor.needsUpdate = true;
  }

  setOverlay(mode: Overlay) {
    this.overlayMode = mode;
    this.overlayRevision = -1;
  }

  /** Подменить мир (загрузка/новая игра) - всё перестраивается. */
  setWorld(w: World) {
    this.world = w;
    this.map.reset();
    this.traffic.reset();
    this.signs.reset();
    this.pedestrians.reset();
    this.fogView.reset();
    this.wasteland.reset();
    this.band.reset();
    this.chunks.forEach((_, i) => this.dirty.add(i));
    this.overlayRevision = -1;
  }

  private drainChanges() {
    const w = this.world;
    if (w.bunker && w.changes.length) {
      const face = bunkerFace(w, w.bunker.root);
      if (face !== this.bunkerFace) {
        this.bunkerFace = face;
        w.changes.push(w.bunker.root);
      }
    }
    for (const idx of w.changes) {
      const x = idx % w.size, y = Math.floor(idx / w.size);
      // Соседние клетки тоже: разметка дорог и фасады зависят от соседей
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
        this.dirty.add(Math.floor(ny / CHUNK) * this.perRow + Math.floor(nx / CHUNK));
      }
    }
    w.changes.length = 0;
  }

  private updateOverlay() {
    const w = this.world;
    if (this.overlayMode === 'none') {
      this.overlayMesh.count = 0;
      return;
    }
    if (this.overlayRevision === w.revision) return;
    this.overlayRevision = w.revision;
    let n = 0;
    const env = this.overlayMode === 'pollution' || this.overlayMode === 'services' ? cityEnv(w) : null;
    w.tiles.forEach((t, i) => {
      let color = -1;
      if (env) color = this.envColor(t, i, env);
      else if (t.object === 'zone') color = (this.overlayMode === 'power' ? t.powered : t.watered) ? 0x4fc3ff : 0xff4d4d;
      else if (t.object === 'building') {
        const def = BUILDING_BY_ID[t.def!];
        if ((this.overlayMode === 'power' && def?.power) || (this.overlayMode === 'water' && def?.water)) color = 0xffd66b;
        else if (this.overlayMode === 'power' && def?.needsPower) color = t.powered ? 0x4fc3ff : 0xff4d4d;
      }
      if (color < 0) return;
      this.tmp.position.set((i % w.size) + 0.5, 0.07, Math.floor(i / w.size) + 0.5);
      this.tmp.updateMatrix();
      this.overlayMesh.setMatrixAt(n, this.tmp.matrix);
      this.overlayMesh.setColorAt(n, this.color.setHex(color));
      n++;
    });
    this.overlayMesh.count = n;
    this.overlayMesh.instanceMatrix.needsUpdate = true;
    if (this.overlayMesh.instanceColor) this.overlayMesh.instanceColor.needsUpdate = true;
  }

  /** Цвет клетки в слоях грязи и услуг, -1 - не подсвечивать. */
  private envColor(t: World['tiles'][number], i: number, env: ReturnType<typeof cityEnv>): number {
    if (t.terrain === 'water') return -1;
    const def = t.object === 'building' ? BUILDING_BY_ID[t.def!] : undefined;
    if (this.overlayMode === 'pollution') {
      // Источники грязи: промзона, генератор, шахта
      if ((t.object === 'zone' && t.zone === 'I' && builtLevel(t) > 0) || (def && (t.def === 'plant' || t.def === 'mine'))) return SOURCE;
      if (t.terrain === 'contaminated') return TOXIC;
      return env.polluted[i] ? SMOG : -1;
    }
    if (def?.service) return SOURCE;
    const c = env.cover[i];
    if (c === 3) return BOTH;
    if (c === 1) return SCHOOL;
    if (c === 2) return CLINIC;
    // Жильё без школы и лазарета - красным: тут дом не вырастет до 3 уровня
    return t.object === 'zone' && t.zone === 'R' ? NO : -1;
  }

  render(camera: THREE.Camera, dt: number) {
    this.time += dt;
    // Куда попали снаряды НЛО: жителям рядом с попаданием падать. Снимок - до того, как
    // налёт заберёт эффекты из w.fx
    this.blasts.length = 0;
    for (const f of this.world.fx) if (f.type === 'explosion') this.blasts.push({ x: f.x / 100, z: f.y / 100 });
    this.pedestrians.setBlasts(this.blasts);
    this.pedestrians.setThreats(this.band.threats(this.world));
    // Банда и автобой забирают свои выстрелы до того, как налёт очистит эффекты
    this.band.update(this.world, camera, dt, this.wasteland.apcPosition);
    // Эффекты достаются бою раньше, чем налёт их заберёт и очистит
    this.tactical.update(this.world.mission, this.world.revision, camera, dt, null, this.world.fx);
    this.raidView.update(this.world, dt);
    // Налёт: сумерки, как на эскизе ночной атаки. Бой: ночь с пожаром у тарелки.
    const m = this.raidView.mood;
    const mission = this.world.mission;
    this.night += ((mission ? 1 : 0) - this.night) * Math.min(1, dt * 1.5);
    // Светофоры и видимые сутки идут вместе с игровым временем: на паузе и в бою стоят
    const speed = this.world.over || mission ? 0 : SPEED_FACTOR[this.world.speed];
    this.cycle.advance(dt, speed);
    const hour = this.cycle.hour;
    const [cityNight, sunset] = skyAt(hour);
    // Ночь боя перекрывает ночь города; закат - тёплым светом, как сумерки налёта
    const dark = 1 - (1 - this.night) * (1 - cityNight * CITY_NIGHT);
    const dusk = Math.max(m, sunset * 0.35);
    const warm = (1 - m) * sunset;
    (this.scene.background as THREE.Color).copy(this.daySky).lerp(this.duskSky, dusk).lerp(this.nightSky, dark);
    this.hemi.intensity = HEMI - dusk * 1.3 - dark * (HEMI - NIGHT_HEMI_LEVEL);
    this.hemi.color.setHex(0xe2ecff).lerp(this.color.setHex(hour < 12 ? DAWN_SKY : EVENING_SKY), warm * 0.4).lerp(this.color.setHex(NIGHT_HEMI), dark);
    this.hemi.groundColor.setHex(0xc2ad8c).lerp(this.color.setHex(NIGHT_GROUND), dark);
    this.sun.intensity = SUN - dusk * 1.9 - dark * (SUN - NIGHT_SUN_LEVEL);
    this.sun.color.setHex(SUN_COLOR).lerp(this.color.setHex(0xff9a6a), m).lerp(this.color.setHex(LOW_SUN), warm * 0.7).lerp(this.moonColor, dark);
    this.fog.color.copy(this.scene.background as THREE.Color);
    // Туман сгущается только в бою: ночной город остаётся виден целиком
    const night = this.night;
    this.fog.near = 400 - night * 280;
    this.fog.far = 900 - night * 690;
    // План улиц: входы, зебры и маршруты общие для машин, пешеходов и отрисовки дорог
    const mapUpdate = this.map.update(this.world);
    if (mapUpdate.crossings) this.chunks.forEach((_, i) => this.dirty.add(i));
    this.map.advanceSignals(dt * speed);
    this.signs.update(this.map);
    this.signs.group.visible = !mission;
    this.traffic.update(this.world, hour, this.cycle.index, dark, dt);
    this.pedestrians.update(this.world, hour, this.cycle.index, dt);
    // В бою огни улицы собираются вокруг места боя; клетки боя мельче клеток города в CELLS раз
    const focus = mission ? { x: (mission.ox + mission.w / 2) / CELLS, z: (mission.oy + mission.h / 2) / CELLS } : undefined;
    this.nightLights.update(hour, dark, camera, dt, focus);
    // Прожектор ПВО: ночью ходит по небу, при налёте доворачивается к тарелке
    this.searchlight.update(this.time, this.world.raid ? this.raidView.target : null, dark);
    if (mapUpdate.places) {
      this.traffic.repopulate();
      this.pedestrians.repopulate();
    }
    if (mission) {
      // Огонь горит неровно: два несоизмеримых колебания дают живую дрожь
      const flicker = 0.8 + 0.2 * Math.sin(this.time * 11.3) * Math.sin(this.time * 5.7);
      this.fire.position.set((mission.ox + mission.w / 2) / CELLS, 0.5, (mission.oy + mission.h / 2) / CELLS);
      this.fire.intensity = night * 11 * flicker;
    } else {
      this.fire.intensity = 0;
    }
    this.drainChanges();
    for (const i of this.dirty) {
      const mesh = this.chunks[i];
      const built = buildChunkGeometry(this.world, (i % this.perRow) * CHUNK, Math.floor(i / this.perRow) * CHUNK, CHUNK, this.map.crossings, this.sprites?.paints);
      mesh.geometry.dispose();
      mesh.geometry = built.geometry;
      this.chunkLights[i] = built.lights;
    }
    // Список огней пересобирается только когда участки действительно перестроены
    const rebuilt = this.dirty.size > 0;
    this.dirty.clear();
    if (rebuilt) {
      this.sprites?.markDirty();
      this.nightLights.setAnchors(this.chunkLights);
      this.syncAa();
    }
    this.updateOverlay();
    this.fogView.update(this.world);
    this.fogView.group.visible = !mission;
    this.wasteland.update(this.world, camera, dt, this.world.research.done.includes('MetalDetector'));
    if (this.sprites) {
      this.spriteTint.copy(SPRITE_DAY).lerp(SPRITE_DUSK, Math.min(1, dusk * 0.8 + warm * 0.4)).lerp(SPRITE_NIGHT, dark);
      const apc = this.wasteland.apcPosition;
      this.sprites.update(this.world, camera, dt, this.spriteTint, dark, this.figures(), this.map.crossings, {
        cars: this.traffic.vehicles(),
        apc: apc ? { x: apc.x, z: apc.z, yaw: this.wasteland.apcYaw, siren: this.wasteland.sirenState } : null,
      });
    }
    this.outline.render(this.scene, camera);
  }

  /** Жители на улицах для слоя спрайтов: модель - в одежду, ребёнок - меньше. */
  private *figures(): Generator<Figure> {
    for (const f of this.pedestrians.figures()) {
      const kind = `civ${CIVILIAN_NAMES.indexOf(f.model) % 3}` as PersonKind;
      yield { id: f.id, x: f.x, z: f.z, yaw: f.yaw, walking: f.walking, kind, scale: f.child ? 0.72 : 1 };
    }
  }

  /** Прожектор стоит у установки ПВО ближе к центру города: там его луч виднее всего. */
  private syncAa() {
    const size = this.world.size;
    const cx = size / 2, cy = size / 2;
    let best = Infinity, bx = 0, by = 0;
    for (let i = 0; i < this.world.tiles.length; i++) {
      const t = this.world.tiles[i];
      if (t.object !== 'building' || !t.def) continue;
      if (BUILDING_BY_ID[t.def]?.category !== 'defense') continue;
      const x = (i % size) + 0.5, y = Math.floor(i / size) + 0.5;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < best) {
        best = d;
        bx = x;
        by = y;
      }
    }
    if (best < Infinity) this.searchlight.setPosition(bx, by);
  }
}
