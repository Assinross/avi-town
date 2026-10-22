// Двоичная куча для поиска пути (броневик, экспедиции).

/** Двоичная куча по стоимости; при равной стоимости - меньший индекс клетки (детерминированно). */
export class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  private less(i: number, j: number) {
    return this.a[i][0] < this.a[j][0] || (this.a[i][0] === this.a[j][0] && this.a[i][1] < this.a[j][1]);
  }
  push(cost: number, cell: number) {
    const a = this.a;
    a.push([cost, cell]);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
