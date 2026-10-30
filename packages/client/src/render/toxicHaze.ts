// Ядовитая дымка над заражённой землёй: мягкие желто-зелёные клубы с дрожью, как воздух над
// нагретым асфальтом. Только над пустой разведанной землёй - дома, дороги и обломки без дымки.
// Три полупрозрачные плоскости на всю карту одна над другой дают объём; где дымка, решает
// маленькая текстура-маска (клетка - пиксель), её сглаживание делает край зоны мягким.

import * as THREE from 'three';
import type { World } from '@avi/sim';
import { PALETTE } from './palette';

/** Высоты слоёв и их доля прозрачности: нижний плотнее, верхний еле виден. */
const LAYERS: [number, number][] = [[0.05, 1], [0.2, 0.7], [0.38, 0.4]];

const VERT = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 p = modelMatrix * vec4(position, 1.0);
  vWorld = p.xz;
  gl_Position = projectionMatrix * viewMatrix * p;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform float uSize, uTime, uSeed, uAlpha, uDark;
uniform vec3 uColor;
varying vec2 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 + 9.1) * 0.15; }
void main() {
  float mask = smoothstep(0.2, 0.9, texture2D(uMask, vWorld / uSize).r);
  if (mask < 0.01) discard;
  // Дрожь нагретого воздуха: мелкая волна сдвигает рисунок клубов туда-сюда
  vec2 p = vWorld * 0.45 + uSeed;
  p.x += sin(p.y * 9.0 + uTime * 3.1) * 0.04;
  p.y += sin(p.x * 8.0 - uTime * 2.3) * 0.035;
  float n = fbm(p + vec2(uTime * 0.1, uTime * 0.04));
  // Отдельные клубы с почти прозрачными просветами: так видно, что дымка, а не цвет земли
  float wisps = smoothstep(0.42, 0.78, n);
  // Медленное дыхание всей зоны
  float breath = 0.85 + 0.15 * sin(uTime * 0.7 + uSeed);
  float a = mask * (0.05 + 0.5 * wisps) * breath * uAlpha;
  // Гребни клубов светлее - кислотный пар; ночью дымка тусклее, но слегка светится
  vec3 c = mix(uColor, vec3(0.93, 1.0, 0.72), wisps * 0.55);
  c = mix(c, uColor * vec3(0.45, 0.7, 0.4), uDark);
  gl_FragColor = vec4(c, a * (1.0 - uDark * 0.35));
}`;

export class ToxicHaze {
  readonly group = new THREE.Group();
  private data: Uint8Array;
  private mask: THREE.DataTexture;
  private materials: THREE.ShaderMaterial[] = [];
  private size: number;

  constructor(size: number) {
    this.size = size;
    this.data = new Uint8Array(size * size);
    this.mask = new THREE.DataTexture(this.data, size, size, THREE.RedFormat);
    this.mask.magFilter = THREE.LinearFilter;
    this.mask.minFilter = THREE.LinearFilter;
    this.mask.needsUpdate = true;
    const plane = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(size / 2, 0, size / 2);
    LAYERS.forEach(([y, alpha], k) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uMask: { value: this.mask }, uSize: { value: size }, uTime: { value: 0 }, uSeed: { value: k * 17.3 },
          uAlpha: { value: alpha }, uDark: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.toxic) },
        },
      });
      const mesh = new THREE.Mesh(plane, mat);
      mesh.position.y = y;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.userData.noOutline = true;
      this.materials.push(mat);
      this.group.add(mesh);
    });
  }

  update(w: World, time: number, dark: number) {
    // Маска: 255 - пустая заражённая разведанная клетка; в видеокарту - только при изменении
    let changed = false, any = false;
    for (let i = 0; i < this.data.length; i++) {
      const t = w.tiles[i];
      const v = t && t.terrain === 'contaminated' && t.object === 'none' && w.explored[i] ? 255 : 0;
      if (v) any = true;
      if (this.data[i] !== v) {
        this.data[i] = v;
        changed = true;
      }
    }
    if (changed) this.mask.needsUpdate = true;
    this.group.visible = any;
    for (const m of this.materials) {
      m.uniforms.uTime.value = time;
      m.uniforms.uDark.value = dark;
    }
  }
}
