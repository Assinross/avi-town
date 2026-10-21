// Типы тактического боя: поле, юниты, укрытия-пропсы, команды и ответы.
// Поведение боя - в map.ts (поле), rules.ts (обзор и перемещение), turn.ts (ходы и команды).

export const CELLS = 4;
export const AREA_RADIUS = 3; // клеток города от тарелки
export const EXPLORE_TICKS_PER_CELL = 3;

/** 0 - свободно, 1 - низкое укрытие (не пройти, видно), 2 - стена (не пройти, не видно). */
export type CellKind = 0 | 1 | 2;

/** Состояние укрытия-пропса: целое, повреждено (обломки), разрушено (пройти можно). */
export type PropState = 'whole' | 'broken' | 'collapsed';

/** Защита, которую даёт укрытие. */
export type CoverLevel = 0 | 20 | 40 | 80;

export interface CoverProp {
  id: number;
  /** Индекс клетки поля: y * m.w + x. */
  cell: number;
  kind: string;
  hp: number;
  maxHp: number;
  state: PropState;
}

export interface TacUnit {
  id: number;
  side: 'xcom' | 'alien';
  kind: string; // 'soldier' или id пришельца
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  aim: number;
  mobility: number;
  damage: [number, number];
  ap: number;
  /** Путь в режиме разведки (реальное время). */
  path: [number, number][];
  moveAcc: number;
  /** Личный боец игрока. */
  personal?: boolean;
  /** Текущие патроны; для бесконечного оружия 0. */
  ammo: number;
  /** Стоит на наблюдении. */
  overwatch: boolean;
  /** Присел (хункер). */
  hunkered: boolean;
}

export interface Mission {
  ufo: string;
  /** Левый верхний угол поля в глобальных боевых клетках (клетка города * CELLS). */
  ox: number;
  oy: number;
  w: number;
  h: number;
  cells: CellKind[];
  units: TacUnit[];
  /** Укрытия-пропсы на поле. */
  props: CoverProp[];
  phase: 'explore' | 'turn' | 'result';
  turn: number;
  result: 'win' | 'lose' | 'retreat' | null;
  /** Последнее событие боя для журнала в интерфейсе. */
  log: string[];
}

export type TacCommand =
  | { type: 'tacMove'; unit: number; x: number; y: number }
  | { type: 'tacShoot'; unit: number; target: number }
  | { type: 'tacReload'; unit: number }
  | { type: 'tacOverwatch'; unit: number }
  | { type: 'tacHunker'; unit: number }
  | { type: 'tacEndTurn' }
  | { type: 'tacRetreat' }
  | { type: 'tacFinish' };

export type TacResult =
  | { ok: true }
  | { ok: false; reason: 'no_mission' | 'not_your_turn' | 'no_ap' | 'unreachable' | 'no_los' | 'dead' | 'no_ammo' | 'no_cover' | 'busy' | 'nothing' };
