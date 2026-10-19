// Изометрическая камера: ортографическая проекция, поворот шагами по 90 градусов,
// приближение колесом от вида района до уровня улицы, перетаскивание правой/средней кнопкой.

import * as THREE from 'three';

const ELEVATION = Math.atan(1 / Math.SQRT2); // классическая изометрия ~35.26 градусов
const VIEW_HALF = 14; // половина видимой высоты в тайлах при zoom = 1

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  private azimuth = Math.PI / 4;
  private azimuthGoal = Math.PI / 4;
  private zoomGoal = 1;

  constructor(private mapSize: number) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.target.set(mapSize / 2, 0, mapSize / 2);
    this.update(0);
  }

  resize(w: number, h: number) {
    const aspect = w / h;
    this.camera.left = -VIEW_HALF * aspect;
    this.camera.right = VIEW_HALF * aspect;
    this.camera.top = VIEW_HALF;
    this.camera.bottom = -VIEW_HALF;
    this.camera.updateProjectionMatrix();
  }

  rotate(step: number) {
    this.azimuthGoal += (step * Math.PI) / 2;
  }

  zoomBy(factor: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * factor, 0.45, 12);
  }

  /** Сдвиг цели камеры на смещение мыши в пикселях. */
  pan(dxPx: number, dyPx: number, viewportH: number) {
    const unitsPerPx = (2 * VIEW_HALF) / this.camera.zoom / viewportH;
    const right = new THREE.Vector3(Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const forward = new THREE.Vector3(-Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    // Вертикальное движение мыши в изометрии сжато на sin(угла наклона)
    this.target.addScaledVector(right, -dxPx * unitsPerPx);
    this.target.addScaledVector(forward, dyPx * unitsPerPx / Math.sin(ELEVATION));
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.mapSize);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.mapSize);
  }

  update(dt: number) {
    const k = dt > 0 ? 1 - Math.exp(-dt * 12) : 1;
    this.azimuth += (this.azimuthGoal - this.azimuth) * k;
    this.camera.zoom += (this.zoomGoal - this.camera.zoom) * k;
    this.camera.updateProjectionMatrix();
    const dist = 150;
    this.camera.position.set(
      this.target.x + Math.cos(this.azimuth) * Math.cos(ELEVATION) * dist,
      this.target.y + Math.sin(ELEVATION) * dist,
      this.target.z + Math.sin(this.azimuth) * Math.cos(ELEVATION) * dist,
    );
    this.camera.lookAt(this.target);
  }
}
