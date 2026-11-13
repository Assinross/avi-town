// Кампания в интерфейсе: цель, источник угрозы, прогресс и итог игры.
import { signal } from '@preact/signals';
import { ECONOMY } from '@avi/data';
import { CAMPAIGN_PHASE_NAMES } from '@avi/sim';
import { hud } from './store';

const detailsOpen = signal(false);
const fmt = (n: number) => n.toLocaleString('ru-RU');

export function CampaignPanel() {
  const h = hud.value;
  const c = h?.campaign;
  if (!h || !c) return null;
  const objective = c.phase === 'contact'
    ? 'Подготовить радар или оборону и обнаружить первый НЛО.'
    : c.phase === 'invasion'
      ? 'Зачистить крушение или гнездо и изучить ксенобиологию, инопланетные материалы и фрагменты оружия.'
      : c.finalStatus === 'locked'
        ? 'Исследовать «Термоядерный пускатель», чтобы подготовить решающую операцию.'
        : c.finalStatus === 'preparing'
          ? `Ожидается командный корабль (день ${c.finalLaunchDay}). Подготовить ПВО и отряд.`
          : c.finalStatus === 'incoming'
            ? 'Сбить командный корабль огнём ПВО.'
            : c.finalStatus === 'crashed'
              ? 'Зачистить место падения флагмана силами отряда.'
              : 'Командование пришельцев уничтожено.';
  const required = ['Xenobiology', 'AlienMaterials', 'WeaponFragments'];
  const completed = required.filter((id) => h.research.done.includes(id)).length;
  return (
    <div class={`panel campaign ${c.threat >= 70 ? 'high' : ''}`}>
      <button class="campaign-toggle" onClick={() => (detailsOpen.value = !detailsOpen.value)} aria-expanded={detailsOpen.value} title="Показать или скрыть детали кампании">
        <b>🛡 {CAMPAIGN_PHASE_NAMES[c.phase]}</b>
        <span>Угроза {c.threat}/100 {detailsOpen.value ? '▴' : '▾'}</span>
      </button>
      <div class="hpbar campaign-meter"><div style={{ width: `${c.threat}%` }} /></div>
      <div class="campaign-goal">{objective}</div>
      {detailsOpen.value && (
        <div class="campaign-details">
          <div>Изменение угрозы: {c.threatDelta > 0 ? '+' : ''}{c.threatDelta}. {c.threatReason}.</div>
          <div>Уровень угрозы влияет на частоту будущих налётов.</div>
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
  return (
    <div class={`panel gameover ${victory ? 'victory' : ''}`}>
      <b>{title}</b>
      <div>{reason}</div>
      <div class="muted">День {h.day} · жителей {fmt(h.stats.population)} · казна {fmt(h.money)} ¢</div>
      <button class={victory ? '' : 'danger'} onClick={actions.newGame}>Новая игра</button>
    </div>
  );
}
