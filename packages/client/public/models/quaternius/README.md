# Ассеты боя: Quaternius Toon Shooter Game Kit

Источник: Quaternius, "Toon Shooter Game Kit" (декабрь 2022).
Страница набора: https://quaternius.com/packs/toonshootergamekit.html
Официальная раздача автора (Google Drive): https://drive.google.com/drive/folders/1-BDs_EIyd6uiF2XuoyiZEcqnMQIJrE0C
Лицензия: CC0 1.0 Universal (Public Domain) - https://creativecommons.org/publicdomain/zero/1.0/
Автор: Quaternius (https://quaternius.com/). Атрибуция не требуется, но указана с благодарностью.

Формат: glTF 2.0 от Blender I/O, буферы встроены в файл, текстур нет - цвета в материалах.

## Состав

- `characters/` - персонажи, у каждого 17 анимаций (Idle, Walk, Walk_Shoot, Run, Run_Gun, Run_Shoot,
  Idle_Shoot, Death, HitReact, Duck, Jump, Jump_Idle, Jump_Land, Punch, Wave, Yes, No):
  - `Character_Soldier.gltf` - боец отряда XCOM,
  - `Character_Hazmat.gltf` - боец в защитном костюме,
  - `Character_Enemy.gltf` - пришелец.
- `props/` - укрытия, разрушаемые объекты и уличная мелочь (кирпичные стены, барьеры,
  контейнеры, ящики, заборы, мешки с песком, взрывные бочки, брошенная машина, обломки,
  фонарь, конус, урны, здоровье, бак).
- `weapons/` - оружие и гранаты (AK, пистолет, револьвер, дробовик, ПП, снайперская,
  граната, зажигательная граната, гранатомёт, РПГ, нож, короткая пушка, лопата).

Если файл нужен для игры - копируется как есть, без правок. Изменения формата/масштаба
делаются в коде (`packages/client/src/render/characters.ts`), а не в самих файлах.
