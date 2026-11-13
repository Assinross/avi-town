// Оперативный журнал: только важные события симуляции, не каждое обновление экономики.
// Хранится в World, поэтому переживает автосохранение и загрузку старых городов.
import { techName, t, UFO_BY_ID } from '@avi/data';
import type { GameEvent, JournalEntry, World } from '@avi/sim';

const ufo = (id: string) => t(UFO_BY_ID[id]?.nameKey ?? id);
const loot = (s: { money?: number; metal?: number; alloys?: number; fragments?: number; elerium?: number }) =>
  [s.money ? `${s.money} ¢` : '', s.metal ? `металл ${s.metal}` : '',
   s.alloys ? `сплавы ${s.alloys}` : '', s.fragments ? `фрагменты ${s.fragments}` : '',
   s.elerium ? `элерий ${s.elerium}` : ''].filter(Boolean).join(' · ') || 'без трофеев';

type Payload = Omit<JournalEntry, 'day'>;

function description(e: GameEvent): Payload | null {
  switch (e.type) {
    case 'openingChoice': return { kind: 'intel', severity: 'info',
      text: e.choice === 'recon' ? 'Выбрана разведка: ранняя информация об угрозах.' : 'Выбрана оборона бункера и дополнительные ресурсы.' };
    case 'openingWreck': return { kind: 'intel', severity: 'warning',
      text: 'Расшифрован сигнал: найден повреждённый разведчик пришельцев.', x: e.x, y: e.y };
    case 'openingWarning': return { kind: 'intel', severity: 'warning', text: `Перехвачен сигнал НЛО. Ожидаемый день: ${e.day}.` };
    case 'openingComplete': return { kind: 'intel', severity: 'success', text: 'Первые операции завершены. Колония вступила в войну.' };
    case 'raidDetected': return { kind: 'intel', severity: 'warning', text: `Радар обнаружил ${ufo(e.ufo)}. Подготовить ПВО.` };
    case 'raidArrived': return { kind: 'combat', severity: 'critical', text: `НЛО над городом: ${ufo(e.ufo)}.` };
    case 'ufoDown': return { kind: 'combat', severity: 'success',
      text: `Сбит ${ufo(e.ufo)}. Место крушения доступно для зачистки.`, x: e.x, y: e.y };
    case 'ufoLeft': return { kind: 'combat', severity: 'warning', text: `${ufo(e.ufo)} ушёл. Проверь повреждения.` };
    case 'ufoLanded': return { kind: 'combat', severity: 'critical',
      text: `Пришельцы высадились из ${ufo(e.ufo)}.`, x: e.x, y: e.y };
    case 'buildingDestroyed': return { kind: 'city', severity: 'critical', text: 'Вражеским огнём разрушено здание.', x: e.x, y: e.y };
    case 'researchDone': return { kind: 'science', severity: 'success', text: `Изучено: ${techName(e.tech)}.` };
    case 'crashCleared': return { kind: 'combat', severity: 'success',
      text: `Крушение ${ufo(e.ufo)} зачищено. Трофеи: ${loot(e.salvage)}. Ранены: ${e.wounded}, выбыли: ${e.down}.` };
    case 'crashExpired': return { kind: 'combat', severity: 'warning', text: `Место крушения ${ufo(e.ufo)} потеряно.` };
    case 'nestCleared': return { kind: 'combat', severity: 'success',
      text: `Гнездо зачищено. Трофеи: ${loot(e.salvage)}. Ранены: ${e.wounded}, выбыли: ${e.down}.` };
    case 'bandSpotted': return { kind: 'intel', severity: 'warning', text: `Обнаружен отряд: ${e.kind === 'aliens' ? 'пришельцы' : 'мутанты'}, ${e.count} бойцов.` };
    case 'bandArrived': return { kind: 'combat', severity: 'critical', text: `В город вошли ${e.kind === 'aliens' ? 'пришельцы' : 'мутанты'}, ${e.count} бойцов.` };
    case 'bandCleared': return { kind: 'combat', severity: 'success', text: `Банда разгромлена. Трофеи: ${loot(e.salvage)}.` };
    case 'bandLeft': return { kind: 'combat', severity: 'warning', text: 'Банда покинула колонию.' };
    case 'fightLost': return { kind: 'combat', severity: 'critical', text: `Отряд потерпел поражение. Выбыли: ${e.down}.` };
    case 'squadRetreated': return { kind: 'combat', severity: 'warning', text: `Отступление отряда. Ранены: ${e.wounded}, выбыли: ${e.down}.` };
    case 'invasionWarning': return { kind: 'intel', severity: 'warning', text: `Получено сообщение о подготовке операции пришельцев. День: ${e.day}.` };
    case 'invasionResult': return { kind: 'combat', severity: e.result === 'repelled' ? 'success' : 'warning',
      text: `Операция «${e.kind}»: ${e.result === 'repelled' ? 'отражена' : e.result === 'landed' ? 'высадка' : 'противник ушёл'}.` };
    case 'invasionSabotage': return { kind: 'city', severity: 'critical',
      text: `Диверсия: отключено сооружение на ${e.days} дн.`, x: e.x, y: e.y };
    case 'invasionRestored': return { kind: 'city', severity: 'success',
      text: 'Инфраструктура восстановлена.', x: e.x, y: e.y };
    case 'militaryDoctrine': return { kind: 'industry', severity: 'info', text: `Выбрана стратегия военной базы: ${e.doctrine}.` };
    case 'militaryProduced': return { kind: 'industry', severity: 'success', text: `Военная мастерская: произведено ${e.count} ед. (${e.item}).` };
    case 'campaignPhase': return { kind: 'intel', severity: 'success', text: `Новый этап кампании: ${e.phase}.` };
    case 'finalShipWarning': return { kind: 'intel', severity: 'critical', text: `Готовится нападение флагмана. День: ${e.day}.` };
    case 'finalShipArrived': return { kind: 'combat', severity: 'critical', text: 'Командный корабль надвигается на колонию!' };
    case 'campaignVictory': return { kind: 'combat', severity: 'success', text: 'Победа: командный корабль уничтожен.' };
    case 'campaignDefeat': return { kind: 'city', severity: 'critical', text: 'Колония погибла. Кампания завершена.' };
    case 'bankrupt': return { kind: 'city', severity: 'critical', text: 'Колония обанкротилась.' };
    default: return null;
  }
}

/** Одна запись на событие, ограниченная память и отсутствие зависимости от часов браузера. */
export function journalEvent(w: World, e: GameEvent) {
  if (w.civic) return;
  const info = description(e);
  if (!info) return;
  w.journal.push({ day: w.day, ...info });
  if (w.journal.length > 80) w.journal.splice(0, w.journal.length - 80);
  w.revision++;
}
