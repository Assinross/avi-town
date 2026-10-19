// Модели юнитов тактического боя: Quaternius Toon Shooter Game Kit (CC0).
// Источник и лицензия - public/models/quaternius/README.md.
// Модели грузятся один раз, на каждого юнита клонируются через SkeletonUtils, анимации
// играет собственный AnimationMixer. Рост нормализуется по скелету: меши и оружие
// в позе привязки дают завышенные габариты.
//
// Персонаж в наборе - это тело из нескольких скелетных мешей плюс десятки мелких деталей
// (броня, оружие), каждая из которых висит на своей кости. Рисовать их по отдельности -
// это ~60 вызовов отрисовки на бойца, поэтому при загрузке все части слипаются в один
// скелетный меш: детали переводятся в пространство привязки и получают вес 1 на свою кость,
// а цвет материала запекается в вершины.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type CharacterName = 'soldier' | 'hazmat' | 'enemy';

/** Рост бойца в единицах сцены: боевая клетка - 0.25, клетка города - 1. */
export const UNIT_HEIGHT = 0.32;

/** Верх головы выше последней кости шеи/головы примерно на столько - по костям и меряем рост. */
const HEAD_TOP = 1.1;

const FILES: Record<CharacterName, string> = {
  soldier: 'characters/Character_Soldier.gltf',
  hazmat: 'characters/Character_Hazmat.gltf',
  enemy: 'characters/Character_Enemy.gltf',
};

const DIR = `${import.meta.env.BASE_URL}models/quaternius/`;

interface Template {
  root: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}

const TEMPLATES = new Map<CharacterName, Template>();
const MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Ближайшая кость выше по дереву - к ней крепится деталь. */
function boneAbove(o: THREE.Object3D): THREE.Bone | null {
  let p: THREE.Object3D | null = o;
  while (p && !(p as THREE.Bone).isBone) p = p.parent;
  return p as THREE.Bone | null;
}

/**
 * Слипает тело и навесные детали в один скелетный меш.
 * Детали жёстко привязаны к костям, поэтому их достаточно перевести в пространство
 * привязки скелета и дать вес 1 на свою кость - анимация их потащит за собой.
 */
function mergeCharacter(scene: THREE.Object3D): THREE.SkinnedMesh | null {
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  const body = meshes.find((m) => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
  if (!body) return null;

  const skeleton = body.skeleton;
  const bindMatrix = body.bindMatrix;
  const bindInverse = bindMatrix.clone().invert();
  const boneIndex = new Map<THREE.Bone, number>();
  skeleton.bones.forEach((b, i) => boneIndex.set(b, i));

  const pos: number[] = [], nrm: number[] = [], col: number[] = [];
  const skinIdx: number[] = [], skinW: number[] = [], index: number[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), m3 = new THREE.Matrix3();
  let base = 0;

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const attr = geo.attributes;
    if (!attr.position) continue;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
    // Место вершины в пространстве привязки скелета
    m4.copy(bindInverse).multiply(mesh.matrixWorld);
    m3.getNormalMatrix(m4);
    const color = ((mesh.material as THREE.MeshLambertMaterial).color ?? new THREE.Color(0xffffff));
    const owner = skinned ? null : boneAbove(mesh);
    const rigid = skinned ? -1 : (owner ? (boneIndex.get(owner) ?? 0) : 0);
    const srcIdx = skinned ? (attr.skinIndex as THREE.BufferAttribute) : null;
    const srcWeight = skinned ? (attr.skinWeight as THREE.BufferAttribute) : null;
    const srcNrm = attr.normal as THREE.BufferAttribute | undefined;

    for (let i = 0; i < attr.position.count; i++) {
      v.fromBufferAttribute(attr.position, i).applyMatrix4(m4);
      pos.push(v.x, v.y, v.z);
      if (srcNrm) n.fromBufferAttribute(srcNrm, i).applyMatrix3(m3).normalize();
      else n.set(0, 1, 0);
      nrm.push(n.x, n.y, n.z);
      col.push(color.r, color.g, color.b);
      if (rigid >= 0) {
        skinIdx.push(rigid, 0, 0, 0);
        skinW.push(1, 0, 0, 0);
      } else {
        for (let k = 0; k < 4; k++) {
          skinIdx.push(srcIdx!.getComponent(i, k));
          skinW.push(srcWeight!.getComponent(i, k));
        }
      }
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) index.push(base + geo.index.getX(i));
    else for (let i = 0; i < attr.position.count; i++) index.push(base + i);
    base += attr.position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  merged.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4));
  merged.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
  merged.setIndex(index);

  const out = new THREE.SkinnedMesh(merged, MATERIAL);
  out.frustumCulled = false;
  out.castShadow = false;
  out.receiveShadow = false;
  // Привязка та же, что у тела: в режиме attached собственная матрица меша сокращается,
  // а bindMatrix задаёт пространство, в котором лежат пересчитанные вершины
  out.bind(skeleton, bindMatrix);
  return out;
}

export async function loadCharacters() {
  const loader = new GLTFLoader();
  await Promise.all((Object.entries(FILES) as [CharacterName, string][]).map(async ([name, path]) => {
    const gltf = await loader.loadAsync(DIR + path);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        o.getWorldPosition(p);
        box.expandByPoint(p);
      }
    });
    // Рост по скелету: меши и оружие в позе привязки дают завышенные габариты
    const scale = UNIT_HEIGHT / Math.max(0.01, (box.max.y - box.min.y) * HEAD_TOP);

    const merged = mergeCharacter(scene);
    if (merged) {
      const old: THREE.Mesh[] = [];
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m !== merged) old.push(m);
      });
      for (const m of old) m.removeFromParent();
      scene.add(merged);
    }

    const root = new THREE.Group();
    root.add(scene);
    scene.scale.setScalar(scale);
    scene.position.y = -box.min.y * scale;
    TEMPLATES.set(name, { root, clips: new Map(gltf.animations.map((c) => [c.name, c])) });
  }));
}

export interface CharacterHandle {
  readonly object: THREE.Object3D;
  /** Зацикленная анимация состояния: Idle, Walk, Run. */
  loop(name: string): void;
  /** Разовая анимация поверх состояния; hold - остаться на последнем кадре (смерть). */
  once(name: string, hold?: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

/** Клон шаблона со своим микшером; null - модель не загружена (тогда рисуется запасная фигура). */
export function createCharacter(name: CharacterName): CharacterHandle | null {
  const template = TEMPLATES.get(name);
  if (!template) return null;
  const object = cloneSkinned(template.root);
  const mixer = new THREE.AnimationMixer(object);
  const actions = new Map<string, THREE.AnimationAction>();
  let base = 'Idle';
  let current: THREE.AnimationAction | null = null;
  let held: THREE.AnimationAction | null = null;

  const action = (n: string) => {
    const clip = template.clips.get(n);
    if (!clip) return null;
    let a = actions.get(n);
    if (!a) {
      a = mixer.clipAction(clip);
      actions.set(n, a);
    }
    return a;
  };

  const fade = (a: THREE.AnimationAction | null, dur: number, restart = false) => {
    if (!a) return;
    if (a === current && !restart) return;
    a.reset().setEffectiveWeight(1).fadeIn(dur).play();
    if (current && current !== a) current.fadeOut(dur);
    current = a;
  };

  // Разовая анимация доиграла - возвращаемся к базовой, кроме смерти (hold)
  mixer.addEventListener('finished', (e) => {
    if (e.action === held) return;
    fade(action(base) ?? null, 0.15);
  });

  return {
    object,
    loop(name) {
      base = template.clips.has(name) ? name : 'Idle';
      held = null;
      const a = action(base);
      if (!a) return;
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = false;
      fade(a, 0.2);
    },
    once(name, hold = false) {
      const a = action(name);
      if (!a) return;
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      held = hold ? a : null;
      fade(a, 0.06, true);
    },
    update(dt) {
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(object);
    },
  };
}
