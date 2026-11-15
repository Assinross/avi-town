// Штаб кампании: первое осмысленное решение, короткие задачи, шкала угрозы и итог игры.
import { signal } from '@preact/signals';
import { ECONOMY, SCENARIOS } from '@avi/data';
import { CAMPAIGN_PHASE_NAMES, INVASION_LABELS, INVASION_TARGETS } from '@avi/sim';
import { hud, openCityPanel, researchOpen } from './store';
import { openCommandCenter } from './CommandCenter';

const detailsOpen = signal(false);
const fmt = (n: number) => n.toLocaleString('ru-RU');

interface CampaignActions {
  openingChoice: (choice: 'recon' | 'fortify') => void;
  focusCrash: () => void;
  focusInvasion: (target: number) => void;
  assault: () => void;
}

function OpeningGuide({ actions }: { actions: CampaignActions }) {
  const h = hud.value;
  const c = h?.campaign;
  const o = c?.opening;
  if (!h || !c || !o || o.complete) return null;
  const progress = Number(o.choice !== null) + Number(o.wreckLocated) +
    Number(c.wrecksCleared + c.nestsCleared > 0) + Number(o.researchStarted) + Number(o.firstRaidFinished);
  let goal = '';
  if (o.choice === null) goal = 'Неизвестный сигнал из пустоши. Реши, как подготовить колонию.';
  else if (!o.wreckLocated) goal = 'Связь установлена. Проложи дороги и подготовь электричество; скоро появятся координаты сигнала.';
  else if (!c.wrecksCleared && h.crash) goal = 'Обнаружено крушение разведчика. Отправь броневик с отрядом за внеземными трофеями.';
  else if (!c.wrecksCleared && !c.nestsCleared) goal = 'Следы первого крушения исчезли. Ищи другие НЛО или гнёзда для захвата трофеев.';
  else if (!o.researchStarted) goal = 'Есть трофеи! Построй генератор и лабораторию, затем начни первое исследование.';
  else if (!o.firstRaidFinished) goal = o.firstRaidWarned
    ? 'НЛО приближается! Построй ПВО и генератор или подготовь временную оборону бункера.'
    : 'Первое исследование запущено. Готовь ПВО: разведывательный налёт скоро начнётся.';
  else goal = 'Первый налёт завершён. Развивай технологии, производство и оборону города.';

  return (
    <div class="campaign-intro">
      <div class="campaign-stage"><b>Первые шаги</b><span>{progress}/5</span></div>
      <div class="campaign-goal">{goal}</div>
      {o.choice === null && (
        <div class="campaign-choices">
          <button onClick={() => actions.openingChoice('recon')} title="Архив ускорит следующее исследование; раннее предупреждение о первом НЛО">
            🔎 Разведка <small>Архив + ранний сигнал</small>
          </button>
          <button onClick={() => actions.openingChoice('fortify')} title="Разовый резерв ресурсов и огневая точка бункера во время первого налёта">
            🛡 Укрепление <small>+1500 ¢, +20 металла, ПВО бункера</small>
          </button>
        </div>
      )}
      {o.wreckLocated && h.crash && !h.convoy && !h.fight && (
        <div class="campaign-choices">
          <button onClick={actions.focusCrash}>📍 Показать крушение</button>
          <button onClick={actions.assault}>🚙 Отправить отряд</button>
        </div>
      )}
      {o.wreckLocated && h.crash && (h.convoy || h.fight) && (
        <div class="muted">Отряд в операции — следи за боем и состоянием бойцов.</div>
      )}
      {c.wrecksCleared + c.nestsCleared > 0 && !o.researchStarted && (
        <div class="campaign-choices">
          <button onClick={() => openCityPanel(researchOpen)}>🔬 Открыть исследования</button>
        </div>
      )}
    </div>
  );
}

export function CampaignPanel({ actions }: { actions: CampaignActions }) {
  const h = hud.value;
  const c = h?.campaign;
  if (!h || !c) return null;
  const objective = c.phase === 'contact'
    ? 'Обнаружить первый инопланетный объект и начать оборону колонии.'
    : c.phase === 'invasion'
      ? 'Зачистить НЛО или гнездо и изучить ксенобиологию, инопланетные материалы и фрагменты оружия.'
      : c.finalStatus === 'locked'
        ? 'Исследовать «Термоядерный пускатель» для решающей операции.'
        : c.finalStatus === 'preparing'
          ? `Ожидается командный корабль (день ${c.finalLaunchDay}). Подготовить ПВО и отряд.`
          : c.finalStatus === 'incoming'
            ? 'Сбить командный корабль огнём ПВО.'
            : c.finalStatus === 'crashed'
              ? 'Зачистить место падения флагмана силами отряда.'
              : 'Командование пришельцев уничтожено.';
  const completed = ['Xenobiology', 'AlienMaterials', 'WeaponFragments']
    .filter((id) => h.research.done.includes(id)).length;
  const pending = c.invasion?.pending;
  const outages = c.invasion?.outages ?? [];
  return (
    <div class={`panel campaign ${c.threat >= 70 ? 'high' : ''}`}>
      <button class="campaign-toggle" onClick={() => (detailsOpen.value = !detailsOpen.value)} aria-expanded={detailsOpen.value} title="Показать или скрыть детали кампании">
        <b>🛡 {CAMPAIGN_PHASE_NAMES[c.phase]}</b>
        <span>Угроза {c.threat}/100 {detailsOpen.value ? '▴' : '▾'}</span>
      </button>
      <div class="hpbar campaign-meter"><div style={{ width: `${c.threat}%` }} /></div>
      <button class="campaign-command-shortcut" onClick={() => openCommandCenter()}>🛰 Штаб и журнал войны →</button>
      {c.scenario && <div class="campaign-scenario" title={SCENARIOS[c.scenario].description}>◎ {SCENARIOS[c.scenario].name} · {SCENARIOS[c.scenario].description}</div>}
      {c.opening && !c.opening.complete ? <OpeningGuide actions={actions} /> : <div class="campaign-goal">{objective}</div>}
      {pending && pending.intel !== 'none' && (
        <div class="invasion-intel">
          <b>
            {pending.intel === 'confirmed'
              ? <>📡 {INVASION_LABELS[pending.kind]}: {INVASION_TARGETS[pending.targetType]}</>
              : '⚠ Неопознанный сигнал из пустоши'}
          </b>
          <div>До операции: {Math.max(0, pending.arrivalDay - h.day)} дн. (день {pending.arrivalDay})</div>
          {pending.intel === 'confirmed' && (
            <button onClick={() => actions.focusInvasion(pending.target)}>📍 Показать ожидаемую цель</button>
          )}
        </div>
      )}
      {outages.length > 0 && <div class="invasion-outage">
        ⚡ Диверсия: {outages.length} объектов отключено.
        Восстановление через {Math.max(0, Math.min(...outages.map((x) => x.untilDay)) - h.day)} дн.
      </div>}
      {detailsOpen.value && (
        <div class="campaign-details">
          <div>Цель кампании: {objective}</div>
          <div>Изменение угрозы: {c.threatDelta > 0 ? '+' : ''}{c.threatDelta}. {c.threatReason}.</div>
          <div>Угроза влияет на частоту будущих налётов.</div>
          <div>Операций пришельцев: {c.invasion?.completed ?? 0}{c.invasion?.last ? <> · Последняя: {INVASION_LABELS[c.invasion.last.kind]}</> : null}</div>
          <div>Сбито НЛО: {c.shipsDown} · Зачищено крушений: {c.wrecksCleared} · Гнёзд: {c.nestsCleared}</div>
          {c.phase === 'invasion' && <div>Исследования: {completed}/3 · Зачистки: {c.wrecksCleared + c.nestsCleared}/1</div>}
          {c.phase === 'counterattack' && <div>Финальная технология: {h.research.done.includes('Fusion_Launcher') ? 'изучена' : 'не изучена'}</div>}
        </div>
      )}
    </div>
  );
}

export function CampaignGameOver({ actions }: { actions: { newGame: () => void } }) {
  const h = hud.value;
  if (!h?.over) return null;
  const victory = h.over === 'victory';
  const title = victory ? 'Победа над вторжением' : h.over === 'bankrupt' ? 'Город обанкротился' : 'Колония погибла';
  const reason = victory
    ? 'Командный корабль сбит, а его экипаж уничтожен. Колония выстояла.'
    : h.over === 'bankrupt'
      ? `${ECONOMY.debt.weeks} недель подряд долг был больше ${fmt(ECONOMY.debt.limit)} ¢. Расходы превысили доходы.`
      : 'Колония потеряла население после периода развития или слишком долго оставалась без пищи.';
  const c = h.campaign;
  const doctrine = h.military?.doctrine === 'air' ? 'Воздушный щит' :
    h.military?.doctrine === 'ground' ? 'Мобильные отряды' :
    h.military?.doctrine === 'science' ? 'Научный рывок' : 'Без специализации';
  return (
    <div class={`panel gameover ${victory ? 'victory' : ''}`}>
      <b>{title}</b>
      <div>{reason}</div>
      <div class="after-action-report">
        <div><span>Кампания</span><strong>{h.day} дн.</strong></div>
        {c?.scenario && <div><span>Сценарий</span><strong>{SCENARIOS[c.scenario].name}</strong></div>}
        <div><span>Жители</span><strong>{fmt(h.stats.population)}</strong></div>
        <div><span>Казна</span><strong>{fmt(h.money)} ¢</strong></div>
        <div><span>Сбито НЛО</span><strong>{c?.shipsDown ?? 0}</strong></div>
        <div><span>Зачищено объектов</span><strong>{(c?.wrecksCleared ?? 0) + (c?.nestsCleared ?? 0)}</strong></div>
        <div><span>Изучено технологий</span><strong>{h.research.done.length}</strong></div>
        <div><span>Операции пришельцев</span><strong>{c?.invasion?.completed ?? 0}</strong></div>
        <div><span>Военная стратегия</span><strong>{doctrine}</strong></div>
      </div>
      <div class="muted">Каждый новый сид создаёт другую карту; три специализации позволяют пройти кампанию по-разному.</div>
      <button class={victory ? '' : 'danger'} onClick={actions.newGame}>Новая игра</button>
    </div>
  );
}
