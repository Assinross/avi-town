// Турник двора: две стойки на бетонных пятках и перекладины между ними.
// Варианты: 2 - одна перекладина | три на разной высоте.

import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const W = 1.8;
const H = 2.3;

export const PULLUP_BAR: PropDef = {
  id: 'pullupBar',
  name: 'Турник',
  variants: 2,
  build(p, v) {
    const post = pick(PALETTE.metal, 2);
    const bar = pick(PALETTE.metal, 0);
    for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) {
      p.box(x, 0, 0, 0.3, 0.08, 0.3, pick(PALETTE.concrete, 1));
      p.box(x, 0.08, 0, 0.09, H - 0.08, 0.09, post);
    }
    const bars = v === 0 ? [H - 0.1] : [H - 0.1, 1.92, 1.62];
    for (const y of bars) p.cylinder(-W / 2 + 0.05, y, 0, 0.025, W - 0.1, bar, 'x', 8);
  },
};
