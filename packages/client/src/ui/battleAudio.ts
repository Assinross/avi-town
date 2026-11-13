// Необязательные синтезированные звуковые сигналы штаба.
// Без внешних ассетов, сторонних библиотек и автоматического включения звука.
import { signal } from '@preact/signals';
import type { GameEvent } from '@avi/sim';

const KEY = 'avi-town.command.audio';
let initial = false;
try { initial = localStorage.getItem(KEY) === '1'; } catch { /* storage disabled */ }
export const battleAudioEnabled = signal(initial);
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
  if (!battleAudioEnabled.value || !audio || audio.state !== 'running') return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
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
