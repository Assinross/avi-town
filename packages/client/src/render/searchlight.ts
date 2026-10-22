// Прожектор ПВО и маячок: ночью луч ходит по небу, при налёте доворачивается к тарелке.
// Углы - чистые функции без Three.js, их проверяют тесты.

import * as THREE from 'three';
import type { QualityProfile } from '../platform/device';

/** Яркость маячка: ровная волна раз в секунду, без резких вспышек. */
export function beaconLevel(t: number): number {
  return 0.55 + 0.45 * Math.sin(t * Math.PI * 2);
}

/** Луч прожектора, когда цели нет: медленно ходит по небу в секторе плюс-минус 60 градусов. */
export function sweepAngle(t: number): { yaw: number; pitch: number } {
  return {
    yaw: Math.sin(t * 0.35) * (Math.PI / 3),
    pitch: 0.95 + Math.sin(t * 0.21) * 0.25,
  };
}

/** Доворот луча к тарелке: yaw - от +z к +x, pitch - от горизонта к зениту. */
export function aimAt(x: number, z: number, ufoX: number, ufoZ: number, ufoY: number): { yaw: number; pitch: number } {
  const dx = ufoX - x, dz = ufoZ - z;
  return {
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(ufoY, Math.hypot(dx, dz)),
  };
}

/** Мягкое пятно: белый центр, прозрачный край - для света на земле у прожектора. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Прожектор на крыше ПВО: конус света, пятно на земле и один настоящий источник. */
export class Searchlight {
  readonly group = new THREE.Group();
  private yawPivot = new THREE.Group();
  private pitchPivot = new THREE.Group();
  private coneMat: THREE.MeshBasicMaterial;
  private spotMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight | null = null;
  private x = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 1;
  private lastT = -1;

  constructor(quality: QualityProfile) {
    const geo = new THREE.ConeGeometry(0.95, 5.2, 14, 1, true);
    // Вершина конуса - в основании прожектора, луч расширяется вверх
    geo.rotateX(Math.PI);
    geo.translate(0, 2.6, 0);
    this.coneMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(geo, this.coneMat);
    cone.frustumCulled = false;
    cone.renderOrder = 2;
    cone.userData.noOutline = true;
    this.pitchPivot.add(cone);
    this.yawPivot.add(this.pitchPivot);
    // Пятно на земле вокруг основания
    const spotGeo = new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2);
    this.spotMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const spot = new THREE.Mesh(spotGeo, this.spotMat);
    spot.position.y = 0.03;
    spot.renderOrder = 3;
    spot.userData.noOutline = true;
    this.group.add(spot);
    this.group.add(this.yawPivot);
    this.group.visible = false;
    // Настоящий источник только на устройствах с запасом мощности
    if (quality.nightLights > 0) {
      this.light = new THREE.PointLight(0xfff3c4, 0, 7, 2);
      this.light.position.y = 0.6;
      this.group.add(this.light);
    }
  }

  setPosition(x: number, z: number) {
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0.45, z);
  }

  /** target - тарелка налёта, иначе луч ходит по небу сам. */
  update(t: number, target: { x: number; y: number; z: number } | null, dark: number) {
    this.group.visible = dark > 0.1;
    if (!this.group.visible) {
      this.lastT = t;
      return;
    }
    const want = target ? aimAt(this.x, this.z, target.x, target.z, target.y) : sweepAngle(t);
    const dt = this.lastT < 0 ? 0.016 : Math.min(0.1, Math.max(0.001, t - this.lastT));
    this.lastT = t;
    const k = Math.min(1, dt * (target ? 2.2 : 1.4));
    // Доворот по кратчайшей дуге: луч не делает лишний оборот
    let d = want.yaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * k;
    this.pitch += (want.pitch - this.pitch) * k;
    this.yawPivot.rotation.y = this.yaw;
    this.pitchPivot.rotation.x = Math.PI / 2 - this.pitch;
    // Ночью луч чуть ярче, днём группа скрыта
    this.coneMat.opacity = 0.1 * Math.min(1, dark * 1.5);
    this.spotMat.opacity = 0.28 * Math.min(1, dark * 1.5);
    if (this.light) this.light.intensity = 1.6 * Math.min(1, dark * 1.5);
  }
}
