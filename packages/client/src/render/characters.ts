// Модели юнитов тактического боя: Quaternius Toon Shooter Game Kit (CC0).
// Источник и лицензия - public/models/quaternius/README.md.
// Модели грузятся один раз, на каждого юнита клонируются через SkeletonUtils, анимации
// играет собственный AnimationMixer. Склейка мешей, рост по скелету и микшер - общий
// код с мирными жителями, он лежит в skinnedModel.ts.

import * as THREE from 'three';
import { createSkinned, loadSkinnedTemplate, type SkinnedHandle, type SkinnedTemplate } from './skinnedModel';

export type CharacterName = 'soldier' | 'hazmat' | 'enemy';

/**
 * Рост бойца в единицах сцены: боевая клетка - 0.25, клетка города - 1.
 * Значение подобрано под прежнюю нормализацию по скелету - бойцы в бою не должны измениться.
 */
export const UNIT_HEIGHT = 0.42;

const FILES: Record<CharacterName, string> = {
  soldier: 'characters/Character_Soldier.gltf',
  hazmat: 'characters/Character_Hazmat.gltf',
  enemy: 'characters/Character_Enemy.gltf',
};

const DIR = `${import.meta.env.BASE_URL}models/quaternius/`;

const TEMPLATES = new Map<CharacterName, SkinnedTemplate>();

export async function loadCharacters() {
  await Promise.all((Object.entries(FILES) as [CharacterName, string][]).map(async ([name, path]) => {
    TEMPLATES.set(name, await loadSkinnedTemplate(DIR + path, UNIT_HEIGHT));
  }));
}

export type CharacterHandle = SkinnedHandle;

/** Клон шаблона со своим микшером; null - модель не загружена (тогда рисуется запасная фигура). */
export function createCharacter(name: CharacterName): CharacterHandle | null {
  const template = TEMPLATES.get(name);
  return template ? createSkinned(template) : null;
}
