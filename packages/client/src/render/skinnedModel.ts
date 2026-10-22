// Общие приёмы для скелетных моделей Quaternius: бойцы и мирные жители устроены одинаково.
// Модель в наборе - это тело из нескольких скелетных мешей плюс мелкие детали (броня, оружие),
// каждая висит на своей кости. Рисовать их по отдельности - десятки вызовов отрисовки на
// персонажа, поэтому при загрузке всё слипается в один скелетный меш: детали переводятся в
// пространство привязки и получают вес 1 на свою кость, цвет материала запекается в вершины.
// Рост нормализуется по габаритам самой отрисовки: у наборов разные масштабы костей и мешей.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

export interface SkinnedTemplate {
  root: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}

export interface SkinnedHandle {
  readonly object: THREE.Object3D;
  /** Зацикленная анимация состояния: Idle, Walk, Run. */
  loop(name: string): void;
  /** Разовая анимация поверх состояния; hold - остаться на последнем кадре (смерть). */
  once(name: string, hold?: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

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
    // Вершины скелетного меша glTF уже лежат в пространстве скелета: собственный трансформ
    // такого узла (у жителей это поворот -90 по X и масштаб 100) по спецификации не применяется.
    // Детали, привязанные к кости, наоборот берутся из мира момента привязки.
    if (skinned) m4.identity();
    else m4.copy(mesh.matrixWorld);
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
  // Привязка с единичной матрицей, как у загрузчика glTF: в режиме attached рендер всё равно
  // берёт обратную матрицу меша, поэтому позиция меша в иерархии на позу не влияет
  out.bind(skeleton, new THREE.Matrix4());
  out.position.set(0, 0, 0);
  out.quaternion.identity();
  out.scale.set(1, 1, 1);
  scene.add(out);
  return out;
}

/**
 * Высота модели с учётом скиннинга, в единицах её корня. Меряем именно результат
 * отрисовки: у части наборов кости и меши живут в разных масштабах (у жителей
 * арматура увеличена в 100 раз), и габариты геометрии об этом не говорят.
 */
function skinnedBox(mesh: THREE.SkinnedMesh): { min: number; max: number } {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let min = Infinity, max = -Infinity;
  const step = Math.max(1, Math.floor(pos.count / 512));
  for (let i = 0; i < pos.count; i += step) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    min = Math.min(min, v.y);
    max = Math.max(max, v.y);
  }
  return { min, max };
}

/**
 * Загрузка одной модели: слипание мешей, рост до height и имена анимаций
 * без префикса набора - у жителей клипы называются "CharacterArmature|Walk".
 */
export async function loadSkinnedTemplate(url: string, height: number): Promise<SkinnedTemplate> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const merged = mergeCharacter(scene);
  if (merged) {
    const old: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== merged) old.push(m);
    });
    for (const m of old) m.removeFromParent();
  }

  const root = new THREE.Group();
  root.add(scene);
  root.updateMatrixWorld(true);
  let scale = height;
  let offset = 0;
  if (merged) {
    const box = skinnedBox(merged);
    scale = height / Math.max(0.01, box.max - box.min);
    offset = -box.min * scale;
  }
  scene.scale.setScalar(scale);
  scene.position.y = offset;
  const clips = new Map(gltf.animations.map((c) => [c.name.split('|').pop()!, c]));
  return { root, clips };
}

/** Клон шаблона со своим микшером; null - модель не загружена (тогда рисуется запасная фигура). */
export function createSkinned(template: SkinnedTemplate): SkinnedHandle {
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
