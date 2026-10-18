// Извлекает русские названия XCOM: Enemy Within из локализации установленной игры
// (только чтение из прототипы/) в packages/data/locale/ru.xcom.json.
// Запуск: npm run extract:xcom

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const locDir = join(root, 'прототипы/XCOM The Complete Edition/game/xew/xcomgame/localization/rus');
const out = join(root, 'packages/data/locale/ru.xcom.json');

// Поле локализации -> префикс ключа в словаре игры
const FIELDS = {
  'xcomgame.rus': {
    m_aItemNames: 'item',
    m_aCharacterName: 'alien',
    AbilityNames: 'ability',
  },
  'xcomstrategygame.rus': {
    TechTypeNames: 'tech',
    TechTypeSummary: 'techDesc',
    m_aFacilityNames: 'facility',
    ItemTypeSummary: 'itemDesc',
  },
};

const dict = {};
for (const [file, fields] of Object.entries(FIELDS)) {
  // Файлы локализации UE3 - UTF-16LE с BOM
  const text = readFileSync(join(locDir, file)).toString('utf16le').replace(/^﻿/, '');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_]+)\[e[A-Za-z]+_([A-Za-z0-9_]+)\]="(.*)"\s*$/);
    if (!m) continue;
    const prefix = fields[m[1]];
    if (!prefix) continue;
    const value = m[3].replace(/\\"/g, '"').replace(/<[^>]+>/g, '').replace(/\\n/g, '\n').trim();
    if (value) dict[`xcom.${prefix}.${m[2]}`] = value;
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(dict, Object.keys(dict).sort(), 2) + '\n');
console.log(`Записано ${Object.keys(dict).length} строк в ${out}`);
