// Камера как у CityRT (FR-007): перспектива с наклоном 35-55 градусов, плавное вращение
// вокруг точки взгляда на любой угол, приближение колесом к точке под курсором, сдвиг карты.
// Q/E и кнопки поворачивают на четверть оборота.

import * as THREE from 'three';

/** Вертикальный угол обзора: узкий - меньше искажений по краям, как у рендеров CityRT. */
const FOV = 35;
const HALF_FOV_TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
/** Половина видимой высоты в точке взгляда (в клетках) при zoom = 1 - как у прежней изометрии. */
const VIEW_HALF = 14;
const ZOOM_MIN = 0.45, ZOOM_MAX = 12;
/** Наклон к земле в градусах: игрок двигает его правой кнопкой вверх-вниз в этих пределах. */
const TILT_MIN = 35, TILT_MAX = 55, TILT_DEFAULT = 46;
/** Крупно камера опускается ниже к улице, издалека смотрит круче - разница наклона в градусах. */
const TILT_BY_ZOOM = 12;
/** Поворот за пиксель движения мыши с правой кнопкой: радианы и градусы наклона. */
const ORBIT_PER_PX = 0.006, TILT_PER_PX = 0.12;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  private azimuth = Math.PI / 4;
  private azimuthGoal = Math.PI / 4;
  private zoomGoal = 1;
  private zoomNow = 1;
  private tilt = TILT_DEFAULT;
  private tiltGoal = TILT_DEFAULT;
  /** Точка экрана (NDC), к которой идёт приближение колесом: земля под ней остаётся на месте. */
  private anchor: THREE.Vector2 | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private before = new THREE.Vector3();
  private after = new THREE.Vector3();

  constructor(private mapSize: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
    this.target.set(mapSize / 2, 0, mapSize / 2);
    this.update(0);
  }

  /** Текущее приближение: 1 - вид района, 12 - уровень улицы. */
  get zoom() {
    return this.zoomNow;
  }

  /** Расстояние от камеры до точки взгляда. */
  get distance() {
    return VIEW_HALF / (this.zoomNow * HALF_FOV_TAN);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Q/E и кнопки: четверть оборота. */
  rotate(step: number) {
    this.azimuthGoal += (step * Math.PI) / 2;
  }

  /** Вращение мышью или двумя пальцами: сразу, без догоняния - камера идёт за рукой. */
  orbit(dxPx: number, dyPx: number) {
    const da = dxPx * ORBIT_PER_PX;
    this.azimuth += da;
    this.azimuthGoal += da;
    this.tiltGoal = this.tilt = THREE.MathUtils.clamp(this.tilt + dyPx * TILT_PER_PX, TILT_MIN, TILT_MAX);
  }

  /** Поворот на угол в радианах (жест двумя пальцами). */
  turn(rad: number) {
    this.azimuth += rad;
    this.azimuthGoal += rad;
  }

  /** at - точка экрана в NDC (-1..1): приближение к ней; без неё - к центру. */
  zoomBy(factor: number, at?: { x: number; y: number }) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * factor, ZOOM_MIN, ZOOM_MAX);
    this.anchor = at ? new THREE.Vector2(at.x, at.y) : null;
  }

  /** Приближение к заданному уровню (камера на бункер, на бой). */
  zoomTo(zoom: number) {
    this.zoomBy(zoom / this.zoomGoal);
  }

  /** Сдвиг цели камеры на смещение мыши в пикселях: точка взгляда едет вместе с рукой. */
  pan(dxPx: number, dyPx: number, viewportH: number) {
    const unitsPerPx = (2 * this.distance * HALF_FOV_TAN) / viewportH;
    const right = new THREE.Vector3(Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const forward = new THREE.Vector3(-Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    // Вертикальное движение мыши на наклонной земле растянуто в 1/sin(наклона)
    this.target.addScaledVector(right, -dxPx * unitsPerPx);
    this.target.addScaledVector(forward, (dyPx * unitsPerPx) / Math.sin(THREE.MathUtils.degToRad(this.pitch())));
    this.clampTarget();
  }

  /** Точка земли под точкой экрана (NDC); null - луч уходит в небо. */
  groundAt(ndc: { x: number; y: number }, out: THREE.Vector3): THREE.Vector3 | null {
    this.ray.setFromCamera(ndc as THREE.Vector2, this.camera);
    return this.ray.ray.intersectPlane(this.ground, out);
  }

  update(dt: number) {
    const k = dt > 0 ? 1 - Math.exp(-dt * 12) : 1;
    // Земля под курсором до шага приближения - после шага возвращаем её под курсор
    const anchored = this.anchor && this.groundAt(this.anchor, this.before);
    this.azimuth += (this.azimuthGoal - this.azimuth) * k;
    this.zoomNow += (this.zoomGoal - this.zoomNow) * k;
    this.tilt += (this.tiltGoal - this.tilt) * k;
    this.place();
    if (anchored && this.anchor && this.groundAt(this.anchor, this.after)) {
      this.target.add(this.before.sub(this.after).setY(0));
      this.clampTarget();
      this.place();
    }
    if (Math.abs(this.zoomGoal - this.zoomNow) < this.zoomGoal * 1e-3) this.anchor = null;
  }

  /** Наклон с поправкой на приближение: у земли камера опускается к улице. */
  private pitch() {
    const t = Math.log(this.zoomNow / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
    return THREE.MathUtils.clamp(this.tilt + TILT_BY_ZOOM * (0.5 - t), TILT_MIN, TILT_MAX);
  }

  private place() {
    const d = this.distance;
    const p = THREE.MathUtils.degToRad(this.pitch());
    const c = this.camera;
    c.position.set(
      this.target.x + Math.cos(this.azimuth) * Math.cos(p) * d,
      this.target.y + Math.sin(p) * d,
      this.target.z + Math.sin(this.azimuth) * Math.cos(p) * d,
    );
    // Ближняя плоскость - от расстояния: глубины хватает и на улице, и над районом
    c.near = Math.max(0.05, d * 0.05);
    c.far = d * 8 + 120;
    c.updateProjectionMatrix();
    c.lookAt(this.target);
    c.updateMatrixWorld();
  }

  private clampTarget() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.mapSize);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.mapSize);
  }
}
