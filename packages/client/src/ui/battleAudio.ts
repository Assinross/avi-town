// Необязательные синтезированные звуковые сигналы штаба.
// Без внешних ассетов, сторонних библиотек и автоматического включения звука.
import { signal } from '@preact/signals';
import type { Fx, GameEvent } from '@avi/sim';

const KEY = 'avi-town.command.audio';
let initial = false;
try { initial = localStorage.getItem(KEY) === '1'; } catch { /* storage disabled */ }
export const battleAudioEnabled = signal(initial);
let savedVolume = 65;
try {
  const stored = localStorage.getItem('avi-town.command.volume');
  if (stored !== null) {
    const v = Number(stored);
    if (Number.isFinite(v) && v >= 0 && v <= 100) savedVolume = v;
  }
} catch { /* браузер запретил хранилище */ }
export const battleAudioVolume = signal(savedVolume);
export function setBattleAudioVolume(volume: number) {
  if (!Number.isFinite(volume)) return;
  const next = Math.max(0, Math.min(100, Math.round(volume)));
  battleAudioVolume.value = next;
  try { localStorage.setItem('avi-town.command.volume', String(next)); } catch { /* storage disabled */ }
}
let audio: AudioContext | null = null;

function unlockAudio() {
  if (!battleAudioEnabled.value) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => { /* Обработка политики автозапуска браузера. */ });
  } catch {
    battleAudioEnabled.value = false;
  }
}

// Если игрок оставил звук включённым ранее, восстанавливаем контекст при первом действии
// пользователя: браузер не разрешает инициализировать воспроизведение при открытии вкладки.
if (initial && typeof document !== 'undefined') {
  const onGesture = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', onGesture);
    document.removeEventListener('keydown', onGesture);
  };
  document.addEventListener('pointerdown', onGesture, { once: true });
  document.addEventListener('keydown', onGesture, { once: true });
}

export function toggleBattleAudio() {
  battleAudioEnabled.value = !battleAudioEnabled.value;
  try { localStorage.setItem(KEY, battleAudioEnabled.value ? '1' : '0'); } catch { /* storage disabled */ }
  // Контекст создаётся после клика пользователя, а не при старте игры.
  if (battleAudioEnabled.value) {
    unlockAudio();
    if (audio?.state === 'running') tone(520, 0.08, 0.025);
  }
}

function tone(frequency: number, duration: number, volume: number, delay = 0) {
  if (!battleAudioEnabled.value || !audio || audio.state !== 'running' || battleAudioVolume.value === 0) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(volume * battleAudioVolume.value / 100, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

export function playBattleCue(type: GameEvent['type']) {
  if (!battleAudioEnabled.value) return;
  if (['raidDetected', 'raidArrived', 'invasionSabotage', 'finalShipArrived', 'bandArrived'].includes(type)) {
    tone(280, 0.18, 0.035);
    tone(390, 0.2, 0.025, 0.22);
  } else if (['ufoDown', 'campaignVictory', 'crashCleared'].includes(type)) {
    tone(620, 0.13, 0.028);
    tone(840, 0.19, 0.022, 0.14);
  } else if (['campaignDefeat', 'bankrupt'].includes(type)) {
    tone(260, 0.24, 0.035);
    tone(165, 0.33, 0.025, 0.22);
  }
}

// Небольшая звуковая реакция на фактические эффекты боя (без музыки и внешних файлов).
// Не озвучиваем каждый снаряд: ограничиваем частоту, чтобы при массированной атаке
// не превращать игру в непрерывный шум и не создавать сотни осцилляторов в секунду.
let nextEffectTime = 0;
export function playBattleEffects(effects: readonly Fx[]) {
  if (!effects.length || !battleAudioEnabled.value || !audio || audio.state !== 'running') return;
  if (audio.currentTime < nextEffectTime) return;
  const explosion = effects.find((fx) => fx.type === 'explosion');
  const aa = effects.find((fx) => fx.type === 'aaShot');
  const alien = effects.find((fx) => fx.type === 'ufoShot' || (fx.type === 'fightShot' && fx.alien));
  const squad = effects.find((fx) => fx.type === 'fightShot' && !fx.alien || fx.type === 'tacShot' && !fx.alien);
  const event = explosion ?? aa ?? alien ?? squad;
  if (!event) return;
  if (event.type === 'explosion') {
    tone(event.big ? 115 : 170, 0.17, 0.03);
    tone(78, 0.12, 0.012, 0.045);
    nextEffectTime = audio.currentTime + 0.28;
  } else if (event.type === 'aaShot') {
    tone(event.hit ? 740 : 510, 0.075, 0.012);
    nextEffectTime = audio.currentTime + 0.16;
  } else if (event.type === 'ufoShot' || event.type === 'fightShot' && event.alien) {
    tone(290, 0.09, 0.014);
    nextEffectTime = audio.currentTime + 0.20;
  } else {
    tone(560, 0.06, 0.012);
    nextEffectTime = audio.currentTime + 0.15;
  }
}
