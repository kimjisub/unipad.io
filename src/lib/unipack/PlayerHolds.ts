/** Counts the player's contacts per pad for the shared pressed overlay. Sound and pack lights
 *  keep their own per-input ownership, including when auto-play presses the same pad. */
export class PlayerHolds {
  private holds = new Map<string, number>();

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  press(x: number, y: number): void {
    const key = this.key(x, y);
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
  }

  release(x: number, y: number): void {
    const key = this.key(x, y);
    const count = this.holds.get(key) ?? 0;
    if (count > 1) this.holds.set(key, count - 1);
    else this.holds.delete(key);
  }

  isHeld(x: number, y: number): boolean {
    return this.holds.has(this.key(x, y));
  }

  clear(): void {
    this.holds.clear();
  }
}
