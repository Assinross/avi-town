// Машины из коробок для улиц (plan.md 010, этап 3; spec FR-022): фургон, пикап, самосвал, автобус,
// скорая - в стиле процедурных зданий, к легковым KayKit. Капот смотрит на +z, низ колёс - на top
// (высота асфальта). Размеры в клетках: легковая KayKit ~0.25 x 0.12, автобус ~0.5.
// И павильон автобусной остановки.

import * as THREE from 'three';
import { GeoBuilder } from './builder';

const TYRE = 0x2b2622;
const GLASS = 0x3e4a55;
const LAMP = 0xf3e7c4;

/** Колёса - тёмные бруски поперёк машины на осях zs. */
function wheels(g: GeoBuilder, top: number, w: number, zs: number[]) {
  for (const z of zs) g.box(0, top, z, w + 0.01, 0.035, 0.05, TYRE);
}

/** Лобовое стекло на передней грани коробки высотой h, начиная с y. */
function windshield(g: GeoBuilder, y: number, z: number, w: number, h: number) {
  g.box(0, y, z, w - 0.02, h, 0.002, GLASS);
}

/** Полоса окон по бокам корпуса: тёмная лента чуть шире кузова. */
function windowBand(g: GeoBuilder, y: number, z: number, w: number, len: number, h: number) {
  g.box(0, y, z, w + 0.004, h, len, GLASS);
}

/** Фары: две светлые точки на передней грани. */
function lamps(g: GeoBuilder, y: number, z: number, w: number) {
  g.box(-w / 2 + 0.025, y, z, 0.022, 0.014, 0.003, LAMP);
  g.box(w / 2 - 0.025, y, z, 0.022, 0.014, 0.003, LAMP);
}

/** Фургон-микроавтобус: высокий кузов, короткий капот. */
export function vanGeometry(top: number, color = 0xe8e4da): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const y = top + 0.03, w = 0.13;
  wheels(g, top, w, [0.08, -0.08]);
  g.box(0, y, -0.025, w, 0.12, 0.22, color, 0, 0xf2efe8);
  g.box(0, y, 0.115, w, 0.065, 0.06, color);
  windshield(g, y + 0.07, 0.086, w, 0.045);
  windowBand(g, y + 0.07, -0.02, w, 0.18, 0.035);
  lamps(g, y + 0.035, 0.146, w);
  return g.build();
}

/** Скорая: белый фургон с красной полосой и синим маячком на крыше. */
export function ambulanceGeometry(top: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const y = top + 0.03, w = 0.13;
  wheels(g, top, w, [0.08, -0.08]);
  g.box(0, y, -0.025, w, 0.125, 0.22, 0xf4f2ec);
  g.box(0, y, 0.115, w, 0.065, 0.06, 0xf4f2ec);
  g.box(0, y + 0.035, -0.025, w + 0.004, 0.022, 0.222, 0xc8322b);
  windshield(g, y + 0.07, 0.086, w, 0.045);
  g.box(0, y + 0.125, 0.06, 0.06, 0.018, 0.025, 0x3a7ee0);
  lamps(g, y + 0.035, 0.146, w);
  return g.build();
}

/** Пикап: кабина и открытый кузов. */
export function pickupGeometry(top: number, color = 0x5d7f9a): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const y = top + 0.03, w = 0.13;
  wheels(g, top, w, [0.085, -0.085]);
  g.box(0, y, 0.115, w, 0.05, 0.07, color); // капот
  g.box(0, y, 0.035, w, 0.1, 0.09, color, 0, 0xd8d4c8); // кабина
  windshield(g, y + 0.055, 0.081, w, 0.04);
  // Кузов: дно и три борта
  g.box(0, y, -0.075, w, 0.02, 0.13, 0x4a4540);
  g.box(-w / 2 + 0.006, y, -0.075, 0.012, 0.055, 0.13, color);
  g.box(w / 2 - 0.006, y, -0.075, 0.012, 0.055, 0.13, color);
  g.box(0, y, -0.134, w, 0.055, 0.012, color);
  lamps(g, y + 0.03, 0.151, w);
  return g.build();
}

/** Самосвал: кабина впереди, высокий кузов-корыто на раме. */
export function dumpGeometry(top: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const y = top + 0.035, w = 0.15;
  wheels(g, top, w, [0.11, -0.04, -0.11]);
  g.box(0, y, 0, w - 0.03, 0.025, 0.3, 0x3a3633); // рама
  g.box(0, y, 0.115, w, 0.11, 0.07, 0xd28a2c, 0, 0xc27c22); // кабина
  windshield(g, y + 0.06, 0.151, w, 0.04);
  g.box(0, y + 0.025, -0.06, w, 0.085, 0.2, 0x8d8a82, 0, 0x6e6a62); // корыто
  g.box(0, y + 0.11, -0.06, w - 0.02, 0.004, 0.18, 0x8b6f4e); // груз
  lamps(g, y + 0.03, 0.151, w);
  return g.build();
}

/** Городской автобус: длинный кузов, лента окон, светлая крыша. */
export function busGeometry(top: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const y = top + 0.03, w = 0.145, len = 0.5;
  wheels(g, top, w, [0.16, -0.16]);
  g.box(0, y, 0, w, 0.16, len, 0xd9b23a, 0, 0xe8e3d6);
  windowBand(g, y + 0.065, -0.01, w, len - 0.06, 0.06);
  g.box(0, y + 0.065, len / 2 - 0.001, w - 0.02, 0.075, 0.004, GLASS); // лобовое
  g.box(0, y + 0.04, 0.0, w + 0.006, 0.012, len + 0.002, 0x2f6aa8); // полоса
  // Табло маршрута над лобовым
  g.box(0, y + 0.142, len / 2 + 0.001, 0.08, 0.014, 0.003, 0xffb347);
  lamps(g, y + 0.025, len / 2 + 0.001, w);
  return g.build();
}

/**
 * Павильон остановки: задняя стенка-стекло, крыша на двух стойках, скамья, табличка.
 * Стоит на тротуаре спиной к зданиям, лицом к улице (+z).
 */
export function shelterGeometry(base: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const w = 0.3, h = 0.17;
  g.box(-w / 2 + 0.008, base, 0, 0.012, h, 0.08, 0x5a5f63); // стойки
  g.box(w / 2 - 0.008, base, 0, 0.012, h, 0.08, 0x5a5f63);
  g.box(0, base, -0.035, w, h - 0.01, 0.006, 0x9fc3d2); // стекло
  g.box(0, base + h, 0, w + 0.02, 0.012, 0.1, 0x4c6b7c); // крыша
  g.box(0, base + 0.04, -0.015, w - 0.05, 0.01, 0.035, 0x8a6a48); // скамья
  // Столбик с табличкой у края
  g.box(w / 2 + 0.05, base, 0.03, 0.01, 0.2, 0.01, 0x5a5f63);
  g.box(w / 2 + 0.05, base + 0.17, 0.03, 0.05, 0.04, 0.006, 0x2f6aa8);
  return g.build();
}
