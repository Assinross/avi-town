import { render } from 'preact';
import * as THREE from 'three';
import { apply, canApply, createWorld, tileAt, type Command, type ReasonCode } from '@avi/sim';
import { CameraRig } from './input/cameraRig';
import { SceneView } from './render/sceneView';
import { Hud } from './ui/Hud';
import { flash, hoverInfo, money, tool } from './ui/store';

const REASONS: Record<ReasonCode, string> = {
  out_of_map: 'За краем карты',
  no_money: 'Не хватает денег',
  blocked: 'Место занято или не подходит',
  no_road: 'Дом нужно ставить рядом с дорогой',
  nothing: 'Здесь нечего сносить',
};
const TERRAIN: Record<string, string> = {
  wasteland: 'Пустошь', soil: 'Плодородная земля', contaminated: 'Заражённая земля', water: 'Вода', rock: 'Камни',
};
const OBJECT: Record<string, string> = {
  none: '', road: 'дорога', house: 'дом поселенцев', ruin: 'руины', tree: 'дерево', rubble: 'завал',
};

const seed = Number(new URLSearchParams(location.search).get('seed')) || 2026;
const world = createWorld(seed, 64);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const view = new SceneView(canvas, world);
const rig = new CameraRig(world.size);

render(<Hud onRotate={(s) => rig.rotate(s)} />, document.getElementById('ui')!);
if (import.meta.env.DEV) Object.assign(window, { avi: { world, rig } });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  view.setSize(w, h);
  rig.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// Выбор тайла лучом из камеры на плоскость земли
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
function tileFromPointer(e: PointerEvent): { x: number; y: number } | null {
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return null;
  const x = Math.floor(hit.x), y = Math.floor(hit.z);
  return tileAt(world, x, y) ? { x, y } : null;
}

function commandFor(t: { x: number; y: number }): Command | null {
  switch (tool.value) {
    case 'road': return { type: 'buildRoad', ...t };
    case 'house': return { type: 'placeHouse', ...t };
    case 'bulldoze': return { type: 'bulldoze', ...t };
    default: return null;
  }
}

let painting = false;
let panning = false;
let last = { x: 0, y: 0 };
let lastTile: { x: number; y: number } | null = null;

// Клетки между двумя точками протягивания без диагональных разрывов - дорога остаётся связной
function* tileLine(a: { x: number; y: number }, b: { x: number; y: number }) {
  let { x, y } = a;
  const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y);
  const sx = Math.sign(b.x - x), sy = Math.sign(b.y - y);
  for (let ix = 0, iy = 0; ix < dx || iy < dy; ) {
    // Шаг по той оси, вдоль которой отрезок "отстаёт" сильнее; деление на 0 даёт Infinity
    if ((0.5 + ix) / dx < (0.5 + iy) / dy) { x += sx; ix++; } else { y += sy; iy++; }
    yield { x, y };
  }
}

function tryApply(t: { x: number; y: number }, silent: boolean) {
  const cmd = commandFor(t);
  if (!cmd) return;
  const res = apply(world, cmd);
  if (!res.ok && !silent) flash(REASONS[res.reason]);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  last = { x: e.clientX, y: e.clientY };
  if (e.button === 1 || e.button === 2) {
    panning = true;
    return;
  }
  const t = tileFromPointer(e);
  if (!t) return;
  painting = tool.value === 'road' || tool.value === 'bulldoze';
  lastTile = t;
  tryApply(t, false);
});
canvas.addEventListener('pointermove', (e) => {
  if (panning) {
    rig.pan(e.clientX - last.x, e.clientY - last.y, window.innerHeight);
    last = { x: e.clientX, y: e.clientY };
    return;
  }
  const t = tileFromPointer(e);
  const cmd = t && commandFor(t);
  view.setCursor(t, !cmd || canApply(world, cmd).ok);
  if (t) {
    const tile = tileAt(world, t.x, t.y)!;
    const obj = OBJECT[tile.object];
    hoverInfo.value = `${TERRAIN[tile.terrain]}${obj ? ', ' + obj : ''} · [${t.x}, ${t.y}]`;
  }
  if (painting && t && lastTile && (t.x !== lastTile.x || t.y !== lastTile.y)) {
    for (const step of tileLine(lastTile, t)) tryApply(step, true);
    lastTile = t;
  }
});
canvas.addEventListener('pointerup', () => {
  painting = false;
  panning = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys.add(e.code);
  if (k === 'q' || k === 'й') rig.rotate(-1);
  if (k === 'e' || k === 'у') rig.rotate(1);
  if (e.code === 'KeyR') tool.value = 'road';
  if (e.code === 'KeyH') tool.value = 'house';
  if (e.code === 'KeyB') tool.value = 'bulldoze';
  if (e.code === 'KeyI' || e.code === 'Escape') tool.value = 'inspect';
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

let prev = performance.now();
function frame(now: number) {
  const dt = Math.min((now - prev) / 1000, 0.1);
  prev = now;
  const step = 600 * dt;
  if (keys.has('KeyW') || keys.has('ArrowUp')) rig.pan(0, step, window.innerHeight);
  if (keys.has('KeyS') || keys.has('ArrowDown')) rig.pan(0, -step, window.innerHeight);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) rig.pan(step, 0, window.innerHeight);
  if (keys.has('KeyD') || keys.has('ArrowRight')) rig.pan(-step, 0, window.innerHeight);
  rig.update(dt);
  money.value = world.money;
  view.render(rig.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
