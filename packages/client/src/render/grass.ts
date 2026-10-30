// Пятнистая трава (US1, FR-006): шум по мировым координатам затемняет и желтит газон пятнами,
// как у CityRT, - вместо клетчатого узора из оттенков клеток. Работает в материале участков:
// пятна получают только горизонтальные поверхности зелёного цвета (трава, газоны, верх крон).

import type * as THREE from 'three';

/** Крупные пятна - в клетках мира на период шума; мелкая рябь поверх них. */
const PATCH_SCALE = 0.45, RIPPLE_SCALE = 1.7;
/** Тёмное пятно (холоднее) и светлое (теплее): множители цвета травы. */
const DARK = '0.6, 0.72, 0.68', LIGHT = '1.08, 1.06, 0.92';

export function patchyGrass(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrassPos;\nvarying float vGrassUp;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vGrassPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGrassUp = normalize(mat3(modelMatrix) * objectNormal).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGrassPos;
        varying float vGrassUp;
        float grassHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float grassNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(grassHash(i), grassHash(i + vec2(1.0, 0.0)), u.x),
                     mix(grassHash(i + vec2(0.0, 1.0)), grassHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_COLOR
          // Трава: поверхность смотрит вверх и зелёный в цвете заметно сильнее красного и синего
          float grassy = smoothstep(0.7, 0.9, vGrassUp) * smoothstep(0.015, 0.05, vColor.g - max(vColor.r, vColor.b));
          if (grassy > 0.0) {
            vec2 q = vGrassPos.xz;
            float n = grassNoise(q * ${PATCH_SCALE}) * 0.65 + grassNoise(q * ${PATCH_SCALE} * 2.3 + 17.0) * 0.35;
            n = smoothstep(0.3, 0.7, n) * 0.8 + grassNoise(q * ${RIPPLE_SCALE}) * 0.2;
            diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(${DARK}), vec3(${LIGHT}), n), grassy);
          }
        #endif`);
  };
}
