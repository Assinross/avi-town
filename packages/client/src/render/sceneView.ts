// Сцена: свет, тени, меш карты (перестраивается при изменении мира) и рамка курсора.

import * as THREE from 'three';
import type { World } from '@avi/sim';
import { buildCityGeometry } from './cityMesh';
import { OutlineRenderer } from './outline';
import { PALETTE } from './palette';

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private outline: OutlineRenderer;
  private cityMesh: THREE.Mesh;
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private builtRevision = -1;
  private cursor: THREE.Mesh;
  private cursorMat = new THREE.MeshBasicMaterial({ color: 0x7ec850, transparent: true, opacity: 0.45, depthWrite: false });

  constructor(canvas: HTMLCanvasElement, private world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.outline = new OutlineRenderer(this.renderer);

    this.scene.background = new THREE.Color(PALETTE.sky);
    this.scene.add(new THREE.HemisphereLight(0xfff3dd, 0x8a7458, 1.6));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    const s = world.size;
    sun.position.set(s * 0.5 - 30, 60, s * 0.5 - 20);
    sun.target.position.set(s / 2, 0, s / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -s * 0.75;
    sun.shadow.camera.right = s * 0.75;
    sun.shadow.camera.top = s * 0.75;
    sun.shadow.camera.bottom = -s * 0.75;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.cityMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.cityMesh.castShadow = true;
    this.cityMesh.receiveShadow = true;
    this.scene.add(this.cityMesh);

    const cursorGeo = new THREE.BoxGeometry(1, 0.06, 1);
    this.cursor = new THREE.Mesh(cursorGeo, this.cursorMat);
    this.cursor.visible = false;
    this.scene.add(this.cursor);
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.outline.setSize(w, h);
  }

  setCursor(tile: { x: number; y: number } | null, ok: boolean) {
    this.cursor.visible = !!tile;
    if (!tile) return;
    this.cursor.position.set(tile.x + 0.5, 0.05, tile.y + 0.5);
    this.cursorMat.color.setHex(ok ? 0x7ec850 : 0xd9534f);
  }

  render(camera: THREE.Camera) {
    if (this.builtRevision !== this.world.revision) {
      this.cityMesh.geometry.dispose();
      this.cityMesh.geometry = buildCityGeometry(this.world);
      this.builtRevision = this.world.revision;
    }
    this.outline.render(this.scene, camera);
  }
}
