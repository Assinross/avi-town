// Стратегический штаб: состояние колонии, оперативная обстановка и сохраняемый журнал.
import { signal } from '@preact/signals';
import { CAMPAIGN_PHASE_NAMES, INVASION_LABELS, INVASION_TARGETS, type JournalEntry } from '@avi/sim';
import { battleAudioEnabled, battleAudioVolume, setBattleAudioVolume, toggleBattleAudio } from './battleAudio';
import { commandOpen, hud } from './store';

type View = 'overview' | 'journal';
type Filter = 'all' | JournalEntry['kind'];
const view = signal<View>('overview');
const filter = signal<Filter>('all');
const label: Record<JournalEntry['kind'], string> = {
  intel: 'Разведка', combat: 'Боевые действия', science: 'Исследования',
  city: 'Колония', industry: 'Производство',
};
const icons: Record<JournalEntry['kind'], string> = {
  intel: '◈', combat: '⚔', science: '✦', city: '◆', industry: '⚙',
};
const phases = { contact: 'Первый контакт', invasion: 'Вторжение', counterattack: 'Контрнаступление' };
const num = (n: number) => n.toLocaleString('ru-RU');

export interface CommandCenterActions {
  focusInvasion: (target: number) => void;
  focusPoint: (x: number, y: number) => void;
  focusCrash: () => void;
  focusBand: () => void;
  focusBunker: () => void;
}

export function openCommandCenter(tab: View = 'overview') {
  view.value = tab;
  commandOpen.value = true;
}

export function CommandCenter({ actions }: { actions: CommandCenterActions }) {
  const h = hud.value;
  if (!commandOpen.value || !h?.campaign) return null;
  const c = h.campaign;
  const inv = c.invasion;
  const pending = inv?.pending;
  const active = h.raid || h.band || h.crash;
  const ready = h.squad.filter((x) => x.days === 0 && !x.away).length;
  const total = h.squad.length;
  const outages = inv?.outages.length ?? 0;
  const current = h.journal?.slice().reverse().filter((e) => filter.value === 'all' || e.kind === filter.value) ?? [];
  const latest = h.journal?.at(-1);
  const danger = c.threat >= 70 || h.raid || h.band?.arrived || outages > 0;
  return (
    <div class="command-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) commandOpen.value = false; }}>
      <section class="command-shell" role="dialog" aria-modal="true" aria-label="Командный центр Avi Town">
        <header class="command-header">
          <div class="command-heading">
            <span class="command-crest">AT<span>⛨</span></span>
            <div>
              <div class="command-eyebrow">AVi TOWN / DEFENSE NETWORK / HQ</div>
              <h2>КОМАНДНЫЙ ЦЕНТР</h2>
              <div class="command-subtitle">Кампания: {CAMPAIGN_PHASE_NAMES[c.phase]} · день {h.day}</div>
            </div>
          </div>
          <button class="command-close" aria-label="Закрыть командный центр" title="Закрыть" onClick={() => commandOpen.value = false}>✕</button>
        </header>
        <div class="command-nav">
          <button class={view.value === 'overview' ? 'selected' : ''} aria-pressed={view.value === 'overview'} onClick={() => (view.value = 'overview')}>◈ ОБСТАНОВКА</button>
          <button class={view.value === 'journal' ? 'selected' : ''} aria-pressed={view.value === 'journal'} onClick={() => (view.value = 'journal')}>▤ ЖУРНАЛ <small>{h.journal.length}</small></button>
          <div class="command-sound">
            <button class="command-audio" onClick={toggleBattleAudio} aria-pressed={battleAudioEnabled.value} title="Звук включается только по желанию игрока">
              {battleAudioEnabled.value ? '♫ Звук: ВКЛ' : '♪ Звук: ВЫКЛ'}
            </button>
            <label class="command-volume" title="Громкость сигналов и боя">
              <span>Громкость {battleAudioVolume.value}%</span>
              <input type="range" min="0" max="100" step="5" value={battleAudioVolume.value}
                disabled={!battleAudioEnabled.value}
                aria-label="Громкость звуков боя"
                onInput={(e) => setBattleAudioVolume(Number(e.currentTarget.value))} />
            </label>
          </div>
        </div>
        {view.value === 'overview' ? (
          <div class="command-body">
            <div class="command-overview">
              <div class="command-primary">
                <div class="command-card command-threat">
                  <div class="command-card-label">УРОВЕНЬ ИНОПЛАНЕТНОЙ УГРОЗЫ</div>
                  <div class="command-threat-value"><strong>{c.threat}</strong><span>/ 100</span><b class={danger ? 'danger' : 'stable'}>{danger ? 'ПОВЫШЕННАЯ ГОТОВНОСТЬ' : 'МОНИТОРИНГ'}</b></div>
                  <div class="command-threat-track"><span style={{ width: `${c.threat}%` }} /></div>
                  <div class="command-delta">{c.threatDelta > 0 ? '+' : ''}{c.threatDelta} · {c.threatReason}</div>
                </div>
                <div class="command-card command-radar-card">
                  <div class="command-card-label">РАДИОЭЛЕКТРОННАЯ ОБСТАНОВКА</div>
                  <div class="command-radar-frame">
                    <div class={`command-radar ${danger ? 'danger' : ''}`}>
                      <span class="command-radar-center">HQ</span>
                      <span class="command-radar-beacon beacon-one" />
                      <span class="command-radar-beacon beacon-two" />
                    </div>
                    <div class="command-scope">
                      <b>{h.raid ? 'НЛО НАД ГОРОДОМ' : pending?.intel === 'confirmed' ? 'СИГНАЛ ПОДТВЕРЖДЁН' : pending ? 'НЕОПОЗНАННЫЙ СИГНАЛ' : 'ЭФИР ПОД КОНТРОЛЕМ'}</b>
                      <span>{h.raid?.operation ? `Операция: ${INVASION_LABELS[h.raid.operation]}` : pending?.intel === 'confirmed' ? `Ожидается: ${INVASION_LABELS[pending.kind]}` : 'Ожидание новых данных'}</span>
                      {pending && <span>Расчётный день: {pending.arrivalDay}</span>}
                      {pending?.intel === 'confirmed' && <span>Цель: {INVASION_TARGETS[pending.targetType]}</span>}
                      <small>Схема радара — индикатор состояния, не географическая карта.</small>
                    </div>
                  </div>
                </div>
              </div>
              <div class="command-secondary">
                <div class="command-card">
                  <div class="command-card-label">ГОТОВНОСТЬ КОЛОНИИ</div>
                  <div class="command-metrics">
                    <div><span>Население</span><b>{num(h.stats.population)}</b></div>
                    <div><span>Казна</span><b>{num(h.money)} ¢</b></div>
                    <div><span>Питание</span><b>{num(h.stats.powerUsed)} / {num(h.stats.powerCap)}</b></div>
                    <div><span>Готовы к выезду</span><b>{ready} / {total}</b></div>
                    <div><span>Объектов отключено</span><b class={outages ? 'danger' : ''}>{outages}</b></div>
                    <div><span>Научный прогресс</span><b>{h.research.done.length} технологий</b></div>
                  </div>
                </div>
                <div class="command-card">
                  <div class="command-card-label">ОПЕРАЦИИ И ПРИКАЗЫ</div>
                  <div class="command-metrics">
                    <div><span>Сбито НЛО</span><b>{c.shipsDown}</b></div>
                    <div><span>Зачистки</span><b>{c.wrecksCleared + c.nestsCleared}</b></div>
                    <div><span>Операции пришельцев</span><b>{inv?.completed ?? 0}</b></div>
                    <div><span>Военная стратегия</span><b>{h.military?.doctrine === 'air' ? 'Воздушный щит' : h.military?.doctrine === 'ground' ? 'Мобильные отряды' : h.military?.doctrine === 'science' ? 'Научный рывок' : 'Не выбрана'}</b></div>
                  </div>
                  <div class="command-buttons">
                    {pending?.intel === 'confirmed' && <button onClick={() => { actions.focusInvasion(pending.target); commandOpen.value = false; }}>◎ Цель НЛО</button>}
                    {h.crash && <button onClick={() => { actions.focusCrash(); commandOpen.value = false; }}>◎ Крушение</button>}
                    {h.band && <button onClick={() => { actions.focusBand(); commandOpen.value = false; }}>◎ Нападение</button>}
                    {h.bunker && <button onClick={() => { actions.focusBunker(); commandOpen.value = false; }}>◎ Бункер</button>}
                  </div>
                </div>
              </div>
            </div>
            <div class="command-footer">
              <span class={active ? 'command-live danger' : 'command-live'}>{active ? '● УГРОЗА АКТИВНА' : '● СИСТЕМЫ В РАБОТЕ'}</span>
              <span>ПОСЛЕДНЕЕ СООБЩЕНИЕ: {latest ? `день ${latest.day} — ${latest.text}` : 'нет зарегистрированных событий'}</span>
              <button onClick={() => (view.value = 'journal')}>В журнал →</button>
            </div>
          </div>
        ) : (
          <div class="command-body command-history">
            <div class="command-filters">
              {(['all', 'combat', 'intel', 'science', 'city', 'industry'] as Filter[]).map((f) => (
                <button class={filter.value === f ? 'selected' : ''} aria-pressed={filter.value === f} onClick={() => (filter.value = f)}>
                  {f === 'all' ? 'Все события' : label[f]}
                </button>
              ))}
            </div>
            <div class="command-entries" role="log" aria-label="История войны">
              {current.length ? current.map((entry, i) => (
                <div class={`command-entry ${entry.severity}`} key={`${entry.day}-${i}`}>
                  <div class="command-entry-kind">{icons[entry.kind]}</div>
                  <div class="command-entry-text">
                    <b>{label[entry.kind]} <span>ДЕНЬ {entry.day}</span></b>
                    <p>{entry.text}</p>
                  </div>
                  {entry.x !== undefined && entry.y !== undefined && (
                    <button title="Перейти к событию на карте" onClick={() => { actions.focusPoint(entry.x!, entry.y!); commandOpen.value = false; }}>⌖</button>
                  )}
                </div>
              )) : <p class="command-empty">По выбранному фильтру событий пока нет. Новые сообщения появятся после разведки и боевых операций.</p>}
            </div>
            <div class="command-footnote">Хранятся последние 80 событий колонии; журнал включён в сохранение игры.</div>
          </div>
        )}
      </section>
    </div>
  );
}
