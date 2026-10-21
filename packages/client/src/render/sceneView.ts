// Сцена: свет, тени, участки карты 16x16 (перестраиваются только изменённые),
// подсветка инструмента и слои (ток, вода, грязь, услуги).

import * as THREE from 'three';
import { builtLevel, cityEnv, dayHour, type World } from '@avi/sim';
import { BUILDING_BY_ID } from '@avi/data';
import { buildChunkGeometry } from './cityMesh';
import { OutlineRenderer } from './outline';
import { PALETTE } from './palette';
import { RaidView } from './raidView';
import { TacticalView } from './tacticalView';
import { Traffic } from './traffic';
import { DESKTOP_QUALITY, type QualityProfile } from '../platform/device';

const CHUNK = 16;
// Свет: прохладное небо подсвечивает тени, тёплое солнце - освещённые стены
const HEMI = 2.7, SUN = 2.6, SUN_COLOR = 0xffd9a8;
// Бой: ночь, луна вместо солнца, свет пожара у места падения
const NIGHT_SKY = 0x131d2e, NIGHT_HEMI = 0x3a5378, NIGHT_GROUND = 0x14161d, MOON = 0x9dbde8;
// Сутки в городе: ночь мягче, чем в бою, - город должно быть видно
const CITY_NIGHT = 0.6;
export type Overlay = 'none' | 'power' | 'water' | 'pollution' | 'services';
// Слои грязи и услуг: источник - жёлтый, жильё без услуг - красный
const SOURCE = 0xffd66b, NO = 0xff4d4d;
const SMOG = 0xff8a3d, TOXIC = 0xa64dff, SCHOOL = 0x4fc3ff, CLINIC = 0xff7ac8, BOTH = 0x5be38a;

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private outline: OutlineRenderer;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private chunks: THREE.Mesh[] = [];
  private dirty = new Set<number>();
  private perRow: number;
  private preview: THREE.InstancedMesh;
  private overlayMesh: THREE.InstancedMesh;
  private overlayRevision = -1;
  private overlayMode: Overlay = 'none';
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();
  private raidView = new RaidView();
  private traffic: Traffic;
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

  constructor(canvas: HTMLCanvasElement, private world: World, labelLayer: HTMLElement, quality: QualityProfile = DESKTOP_QUALITY) {
    this.tactical = new TacticalView(labelLayer);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.outline = new OutlineRenderer(this.renderer);

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
    this.traffic = new Traffic(quality.maxCars);
    this.scene.add(this.traffic.group);
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.outline.setSize(w, h);
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
    this.traffic.reset();
    this.chunks.forEach((_, i) => this.dirty.add(i));
    this.overlayRevision = -1;
  }

  private drainChanges() {
    const w = this.world;
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
    // Эффекты достаются бою раньше, чем налёт их заберёт и очистит
    this.tactical.update(this.world.mission, this.world.revision, camera, dt, null, this.world.fx);
    this.raidView.update(this.world, dt);
    // Налёт: сумерки, как на эскизе ночной атаки. Бой: ночь с пожаром у тарелки.
    const m = this.raidView.mood;
    const mission = this.world.mission;
    this.night += ((mission ? 1 : 0) - this.night) * Math.min(1, dt * 1.5);
    const hour = dayHour(this.world);
    const [cityNight, sunset] = skyAt(hour);
    // Ночь боя перекрывает ночь города; закат - тёплым светом, как сумерки налёта
    const dark = 1 - (1 - this.night) * (1 - cityNight * CITY_NIGHT);
    const dusk = Math.max(m, sunset * 0.6);
    (this.scene.background as THREE.Color).copy(this.daySky).lerp(this.duskSky, dusk).lerp(this.nightSky, dark);
    this.hemi.intensity = HEMI - dusk * 1.3 - dark * (HEMI - 1.9);
    this.hemi.color.setHex(0xe2ecff).lerp(this.color.setHex(NIGHT_HEMI), dark);
    this.hemi.groundColor.setHex(0xc2ad8c).lerp(this.color.setHex(NIGHT_GROUND), dark);
    this.sun.intensity = SUN - dusk * 1.9 - dark * (SUN - 1.0);
    this.sun.color.setHex(SUN_COLOR).lerp(this.color.setHex(0xff9a6a), dusk).lerp(this.moonColor, dark);
    this.fog.color.copy(this.scene.background as THREE.Color);
    // Туман сгущается только в бою: ночной город остаётся виден целиком
    const night = this.night;
    this.fog.near = 400 - night * 280;
    this.fog.far = 900 - night * 690;
    this.traffic.update(this.world, hour, dark, dt);
    if (mission) {
      // Огонь горит неровно: два несоизмеримых колебания дают живую дрожь
      const flicker = 0.8 + 0.2 * Math.sin(this.time * 11.3) * Math.sin(this.time * 5.7);
      this.fire.position.set(mission.ox + mission.w / 2, 0.5, mission.oy + mission.h / 2);
      this.fire.intensity = night * 11 * flicker;
    } else {
      this.fire.intensity = 0;
    }
    this.drainChanges();
    for (const i of this.dirty) {
      const mesh = this.chunks[i];
      mesh.geometry.dispose();
      mesh.geometry = buildChunkGeometry(this.world, (i % this.perRow) * CHUNK, Math.floor(i / this.perRow) * CHUNK, CHUNK);
    }
    this.dirty.clear();
    this.updateOverlay();
    this.outline.render(this.scene, camera);
  }
}

/** Ночь 0..1 и закат/рассвет 0..1 по часу суток: светло с 7 до 18:30, темно с 21 до 5. */
function skyAt(hour: number): [number, number] {
  const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (hour - a) / (b - a)));
  const night = hour < 12 ? 1 - ramp(5, 7) : ramp(18.5, 21);
  // Тёплый свет у самого горизонта: в 6 утра и около 19:30
  const sunset = Math.max(0, 1 - Math.abs(hour - 6) / 1.2, 1 - Math.abs(hour - 19.5) / 1.5);
  return [night, sunset];
}
