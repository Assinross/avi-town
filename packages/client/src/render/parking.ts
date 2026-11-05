// Общая раскладка парковок для геометрии участка и настоящих машин трафика.
import { DIRS, lotCenter, usesLots, type LotShape, type World } from '@avi/sim';

export interface ParkingPoint { x: number; z: number }
export interface ParkingSpot extends ParkingPoint {
  id: string;
  owner: number;
  road: number;
  yaw: number;
}

/** Центры парковочных клеток в осях участка, как в cityMesh.addLot. */
export function parkingCells(s: LotShape, zone: string, level: number, v: number, detailed: boolean): [number, number][] {
  const side = (s.w - 1) / 2, front = (s.d - 1) / 2, back = -front;
  const flip = v & 1 ? 1 : -1;
  if (zone === 'R' && level >= 3) return detailed ? [[-flip * side, back]] : [[-side, back], [side, back]];
  if (zone !== 'C' || level < 2) return [];
  if (level === 2) return v % 3 === 1 ? [] : [[-flip * side, 0]];
  const garden = v % 4 === 2 || (detailed && v % 4 === 0 && ((v >> 3) & 1) === 1);
  return [-side, side].filter((u) => !garden || u !== flip * side).map((u) => [u, front]);
}

/** Шесть мест на клетку: три столбца, два ряда, машины вдоль разделительных линий. */
export function parkingSpots(w: World, detailed: boolean): ParkingSpot[] {
  const out: ParkingSpot[] = [];
  w.tiles.forEach((t, owner) => {
    if (t.object !== 'zone' || !usesLots(t) || t.root !== owner || t.build > 0 || !w.explored[owner]) return;
    const c = lotCenter(w, owner);
    if (!c) return;
    const [dx, dz] = DIRS[c.s.dir];
    const at = (u: number, f: number): ParkingPoint => ({ x: c.x + dz * u + dx * f, z: c.y - dx * u + dz * f });
    parkingCells(c.s, t.zone!, t.level, t.variant, detailed).forEach(([u, f], lot) => {
      const edge = u + (u < 0 ? -0.42 : 0.42);
      const street = at(edge, c.s.d / 2 + 0.5);
      const x = Math.floor(street.x), y = Math.floor(street.z);
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) return;
      const road = y * w.size + x;
      if (w.tiles[road].object !== 'road' || !w.explored[road]) return;
      for (const row of [-1, 1]) for (let col = 0; col < 3; col++) {
        const column = u - 0.24 + col * 0.24;
        const point = at(column, f + row * 0.3);
        out.push({ ...point, id: `${owner}:${lot}:${row}:${col}`, owner, road,
          yaw: Math.atan2(dx, dz) + (row < 0 ? Math.PI : 0) });
      }
    });
  });
  return out;
}
