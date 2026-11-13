// Кампания против пришельцев: фазы, оценка угрозы, условия победы и поражения.
// Логика целочисленна и не использует внешнюю случайность.
import type { CampaignPhase, CampaignState, World } from './world';

export const CAMPAIGN_PHASE_NAMES: Record<CampaignPhase, string> = {
  contact: 'Первый контакт',
  invasion: 'Вторжение',
  counterattack: 'Контрнаступление',
};

export function newCampaign(): CampaignState {
  return {
    phase: 'contact', threat: 10, threatDelta: 0, threatReason: 'Начальная оценка',
    firstContact: false, shipsDown: 0, wrecksCleared: 0, nestsCleared: 0,
    peakPopulation: 0, collapseDays: 0, finalStatus: 'locked', finalLaunchDay: null,
  };
}

/** Старые города получают кампанию с учётом уже исследованных технологий. */
export function migratedCampaign(w: World): CampaignState | null {
  if (w.civic) return null;
  const c = newCampaign();
  c.peakPopulation = w.stats?.population ?? 0;
  c.firstContact = !!(w.raid || w.crash || w.research.done.length || w.day >= 330);
  if (c.firstContact) c.phase = 'invasion';
  if (['Xenobiology', 'AlienMaterials', 'WeaponFragments'].every((id) => w.research.done.includes(id)) &&
      (w.resources.alloys + w.resources.fragments + w.resources.elerium > 0)) {
    c.phase = 'counterattack';
    c.shipsDown = 1;
    c.wrecksCleared = 1;
  }
  return c;
}

function changeThreat(w: World, delta: number, reason: string) {
  const c = w.campaign;
  if (!c || w.over) return;
  const next = Math.max(0, Math.min(100, c.threat + delta));
  c.threatDelta = next - c.threat;
  c.threat = next;
  c.threatReason = reason;
  w.revision++;
}

function enterPhase(w: World, phase: CampaignPhase) {
  const c = w.campaign;
  if (!c || c.phase === phase) return;
  c.phase = phase;
  w.events.push({ type: 'campaignPhase', phase });
  w.revision++;
}

/** Первый контакт фиксируется только один раз, независимо от типа обнаружения. */
export function campaignContact(w: World) {
  const c = w.campaign;
  if (!c || c.firstContact || w.over) return;
  c.firstContact = true;
  changeThreat(w, 12, 'Обнаружены силы пришельцев');
  enterPhase(w, 'invasion');
}

export function campaignShipDown(w: World, final: boolean) {
  const c = w.campaign;
  if (!c || w.over) return;
  campaignContact(w);
  c.shipsDown++;
  changeThreat(w, final ? -20 : -8, final ? 'Командный корабль сбит' : 'НЛО сбит силами колонии');
  if (final) {
    c.finalStatus = 'crashed';
    w.revision++;
  }
}

export function campaignShipLanded(w: World, final: boolean) {
  campaignContact(w);
  if (final && w.campaign) {
    w.campaign.finalStatus = 'crashed';
    w.revision++;
  }
}

function scheduleReturn(w: World) {
  const c = w.campaign;
  if (!c) return;
  c.finalStatus = 'preparing';
  c.finalLaunchDay = w.day + 35;
  w.events.push({ type: 'finalShipWarning', day: c.finalLaunchDay });
  w.revision++;
}

export function campaignShipEscaped(w: World, final: boolean) {
  if (!w.campaign || w.over) return;
  changeThreat(w, final ? 15 : 8, final ? 'Флагман ушёл для перегруппировки' : 'НЛО ушёл безнаказанным');
  if (final) scheduleReturn(w);
}

export function campaignWreckExpired(w: World, final: boolean) {
  if (!w.campaign || w.over) return;
  if (final) {
    changeThreat(w, 12, 'Экипаж флагмана покинул место крушения');
    scheduleReturn(w);
  }
}

/** Вызывается только после выигранной операции зачистки. */
export function campaignClearWreck(w: World, final: boolean) {
  const c = w.campaign;
  if (!c || w.over) return;
  c.wrecksCleared++;
  changeThreat(w, final ? -20 : -6, final ? 'Командование пришельцев уничтожено' : 'Захвачены технологии НЛО');
  if (final) {
    c.finalStatus = 'destroyed';
    w.over = 'victory';
    w.speed = 0;
    w.events.push({ type: 'campaignVictory' });
    w.revision++;
  }
}

export function campaignClearNest(w: World) {
  const c = w.campaign;
  if (!c || w.over) return;
  c.nestsCleared++;
  changeThreat(w, -5, 'Ликвидировано гнездо пришельцев');
}

/** Запуск финального противника происходит по обычным правилам радаров и ПВО. */
export function campaignFinalLaunched(w: World) {
  const c = w.campaign;
  if (!c) return;
  c.finalStatus = 'incoming';
  c.finalLaunchDay = null;
  w.events.push({ type: 'finalShipArrived' });
  changeThreat(w, 15, 'Командный корабль приближается к колонии');
}

/** Проверять после перерасчёта дня, когда исследования и население уже обновились. */
export function campaignDay(w: World) {
  const c = w.campaign;
  if (!c || w.over) return;
  if (w.day % 14 === 0) changeThreat(w, 1, 'Вторжение постепенно усиливается');
  c.peakPopulation = Math.max(c.peakPopulation, w.stats.population);
  // Пустая начальная карта - не поражение. Теряется только уже существовавшая колония.
  c.collapseDays = c.peakPopulation >= 15 && w.stats.population === 0 ? c.collapseDays + 1 : 0;
  if (c.collapseDays >= 7 || (w.day > 30 && c.peakPopulation >= 15 && w.hungerDays >= 28)) {
    w.over = 'colonyLost';
    w.speed = 0;
    w.events.push({ type: 'campaignDefeat' });
    w.revision++;
    return;
  }
  if (c.phase === 'invasion' && c.wrecksCleared + c.nestsCleared > 0 &&
      ['Xenobiology', 'AlienMaterials', 'WeaponFragments'].every((id) => w.research.done.includes(id))) {
    enterPhase(w, 'counterattack');
  }
  if (c.phase === 'counterattack' && c.finalStatus === 'locked' && w.research.done.includes('Fusion_Launcher')) {
    c.finalStatus = 'preparing';
    c.finalLaunchDay = w.day + 7;
    w.events.push({ type: 'finalShipWarning', day: c.finalLaunchDay });
    w.revision++;
  }
}
