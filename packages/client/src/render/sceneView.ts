// Сцена: свет, тени, участки карты 16x16 (перестраиваются только изменённые),
// подсветка инструмента и слои (ток, вода).

import * as THREE from 'three';
import type { World } from '@avi/sim';
import { BUILDING_BY_ID } from '@avi/data';
import { buildChunkGeometry } from './cityMesh';
import { OutlineRenderer } from './outline';
import { PALETTE } from './palette';
import { RaidView } from './raidView';

const CHUNK = 16;
export type Overlay = 'none' | 'power' | 'water';

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
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private daySky = new THREE.Color(PALETTE.sky);
  private duskSky = new THREE.Color(0x5b4a63);

  constructor(canvas: HTMLCanvasElement, private world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.outline = new OutlineRenderer(this.renderer);

    this.scene.background = new THREE.Color(PALETTE.sky);
    this.hemi = new THREE.HemisphereLight(0xfff3dd, 0x8a7458, 1.6);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    this.sun = sun;
    const s = world.size;
    sun.position.set(s * 0.5 - 30, 60, s * 0.5 - 20);
    sun.target.position.set(s / 2, 0, s / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -s * 0.75, right: s * 0.75, top: s * 0.75, bottom: -s * 0.75, far: 200 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

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
    this.scene.add(this.preview);
    this.overlayMesh = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), s * s);
    this.overlayMesh.count = 0;
    this.overlayMesh.renderOrder = 1;
    this.overlayMesh.frustumCulled = false;
    this.scene.add(this.overlayMesh);
    this.scene.add(this.raidView.group);
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.outline.setSize(w, h);
  }

  /** Подсветка клеток под инструментом: зелёная - можно, красная - нельзя. */
  setPreview(cells: { x: number; y: number; ok: boolean }[]) {
    this.preview.count = cells.length;
    cells.forEach((c, i) => {
      this.tmp.position.set(c.x + 0.5, 0.08, c.y + 0.5);
      this.tmp.updateMatrix();
      this.preview.setMatrixAt(i, this.tmp.matrix);
      this.preview.setColorAt(i, this.color.setHex(c.ok ? 0x4fc3ff : 0xff4d4d));
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
    w.tiles.forEach((t, i) => {
      let color = -1;
      if (t.object === 'zone') color = (this.overlayMode === 'power' ? t.powered : t.watered) ? 0x4fc3ff : 0xff4d4d;
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

  render(camera: THREE.Camera, dt: number) {
    this.raidView.update(this.world, dt);
    // Налёт: сумерки, как на эскизе ночной атаки
    const m = this.raidView.mood;
    (this.scene.background as THREE.Color).copy(this.daySky).lerp(this.duskSky, m);
    this.hemi.intensity = 1.6 - m * 0.8;
    this.sun.intensity = 2.2 - m * 1.4;
    this.sun.color.setHex(0xffe2b8).lerp(new THREE.Color(0xff9a6a), m);
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
