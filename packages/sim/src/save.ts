// Сохранение мира: JSON с версией формата; служебные поля (changes) не сохраняются.

import { SAVE_VERSION, emptyStats, type World } from './world';

export interface SaveFile {
  format: 'avitown-save';
  saveVersion: number;
  savedAt: string;
  world: Omit<World, 'changes'>;
}

export function serialize(w: World): string {
  const { changes: _changes, ...rest } = w;
  const file: SaveFile = { format: 'avitown-save', saveVersion: SAVE_VERSION, savedAt: new Date().toISOString(), world: rest };
  return JSON.stringify(file);
}

export type LoadResult = { ok: true; world: World } | { ok: false; reason: 'bad_format' | 'too_new' | 'too_old' };

export function deserialize(json: string): LoadResult {
  let file: SaveFile;
  try {
    file = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'bad_format' };
  }
  if (file?.format !== 'avitown-save' || !file.world?.tiles) return { ok: false, reason: 'bad_format' };
  if (file.saveVersion > SAVE_VERSION) return { ok: false, reason: 'too_new' };
  // Версия 1 (первый срез) не сохранялась - миграций пока нет
  if (file.saveVersion < SAVE_VERSION) return { ok: false, reason: 'too_old' };
  const world: World = { ...file.world, stats: { ...emptyStats(), ...file.world.stats }, changes: [] };
  return { ok: true, world };
}
