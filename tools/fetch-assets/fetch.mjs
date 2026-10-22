// Скачивание сторонних моделей, которые лежат в packages/client/public/models.
// Запуск: node tools/fetch-assets/fetch.mjs
//
// Все модели ниже - CC0 (public domain). Ссылки ведут на poly.pizza (Quaternius) и
// GitHub KayKit - официальные площадки авторов; файлы кладутся как есть, без правок.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const MODELS = join(ROOT, 'packages/client/public/models');

const POLY = 'https://static.poly.pizza';
const KAYKIT = 'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0/main/addons/kaykit_city_builder_bits/Assets/gltf';

// Мирные жители: Quaternius, Ultimate Modular Men Pack и Ultimate Modular Women Pack.
// У каждой модели 4 меша на общем скелете и 24 анимации (Idle, Walk, Run, Interact, HitReceive, Death и другие).
const CIVILIANS = [
  ['casual', `${POLY}/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb`],
  ['hoodie', `${POLY}/bcd66ec5-5e81-4901-a222-47abc875fe2a.glb`],
  ['worker', `${POLY}/3a5f3056-ffe6-42eb-bd52-122afcbd22b2.glb`],
  ['farmer', `${POLY}/81f2f0cf-6f53-4b57-92ea-dba0928620f2.glb`],
  ['businessman', `${POLY}/e599abbe-7d73-488c-9d7e-3ead281e705c.glb`],
  ['woman', `${POLY}/46d6db5a-3c9f-4238-8cdf-8eb7194498dc.glb`],
  ['suit', `${POLY}/1bd7759c-ab76-4178-8fe6-7706dffa7d5f.glb`],
];

// Светофоры: KayKit City Builder Bits (CC0). Текстура палитры у проекта уже есть.
const KAYKIT_FILES = ['a', 'b', 'c'].flatMap((key) => [
  [`kaykit/trafficlight_${key}.gltf`, `${KAYKIT}/trafficlight_${key.toUpperCase()}.gltf`],
  [`kaykit/trafficlight_${key}.bin`, `${KAYKIT}/trafficlight_${key.toUpperCase()}.bin`],
]);

async function get(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1024).toFixed(0)} kB  ${dest.slice(ROOT.length + 1)}`);
}

for (const [name, url] of CIVILIANS) await get(url, join(MODELS, 'civilians', `${name}.glb`));
for (const [path, url] of KAYKIT_FILES) await get(url, join(MODELS, path));
