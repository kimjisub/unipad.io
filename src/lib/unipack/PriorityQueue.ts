/** Earliest item first, with logarithmic insertion and removal. Tie order belongs to the comparator. */
export class PriorityQueue<T> {
  private heap: T[] = [];

  constructor(private compare: (a: T, b: T) => number) {}

  peek(): T | undefined { return this.heap[0]; }

  clear(): void { this.heap.length = 0; }

  push(item: T): void {
    let i = this.heap.length;
    this.heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.heap[parent], item) <= 0) break;
      this.heap[i] = this.heap[parent];
      i = parent;
    }
    this.heap[i] = item;
  }

  pop(): T | undefined {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.heap.length && this.compare(this.heap[child + 1], this.heap[child]) < 0) child++;
        if (this.compare(last!, this.heap[child]) <= 0) break;
        this.heap[i] = this.heap[child];
        i = child;
      }
      this.heap[i] = last!;
    }
    return first;
  }
}
