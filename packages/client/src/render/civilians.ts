// Мирные жители на улицах: Quaternius Ultimate Modular Men Pack и Women Pack (CC0).
// Источник, лицензия и состав - public/models/civilians/README.md.
// У каждой модели один общий скелет и 24 анимации (Idle, Walk, Run, Interact, HitReceive,
// Death и другие); рост нормализуется по скелету до городского масштаба.

import { createSkinned, loadSkinnedTemplate, type SkinnedHandle, type SkinnedTemplate } from './skinnedModel';

export type CivilianName = 'casual' | 'hoodie' | 'worker' | 'farmer' | 'businessman' | 'woman' | 'suit';

export const CIVILIAN_NAMES: readonly CivilianName[] = ['casual', 'hoodie', 'worker', 'farmer', 'businessman', 'woman', 'suit'];

/** Рост взрослого жителя в клетках города. Длина легковой машины - около 0.25 клетки. */
export const CIVILIAN_HEIGHT = 0.11;

const DIR = `${import.meta.env.BASE_URL}models/civilians/`;

const TEMPLATES = new Map<CivilianName, SkinnedTemplate>();

export async function loadCivilians() {
  await Promise.all(CIVILIAN_NAMES.map(async (name) => {
    TEMPLATES.set(name, await loadSkinnedTemplate(DIR + name + '.glb', CIVILIAN_HEIGHT));
  }));
}

/** Клон модели жителя со своим микшером; null - модели нет (житель не рисуется). */
export function createCivilian(name: CivilianName): SkinnedHandle | null {
  const template = TEMPLATES.get(name);
  return template ? createSkinned(template) : null;
}
