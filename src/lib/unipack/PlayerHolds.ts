/**
 * The pads the player is holding down with a finger, a key or a controller, counted per pad because
 * two inputs can hold the same one. When autoPlay stops pressing pads (turned off, paused, seeking,
 * switched to practice, ended) the play screen releases every other pad: an endless loop autoPlay left
 * held stops, while one the player still holds keeps sounding until the player lets go.
 */
export class PlayerHolds {
  private holds = new Map<string, number>();
  // Held pads autoPlay stopped over: autoPlay's press there ends with the player's last release.
  private leftToPlayer = new Set<string>();

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  press(x: number, y: number): void {
    const key = this.key(x, y);
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
  }

  /** Returns true when this was the last hold of a pad autoPlay stopped over, so every press of the
   *  pad, autoPlay's too, is to be released. */
  release(x: number, y: number): boolean {
    const key = this.key(x, y);
    const count = this.holds.get(key) ?? 0;
    if (count > 1) {
      this.holds.set(key, count - 1);
      return false;
    }
    this.holds.delete(key);
    return this.leftToPlayer.delete(key);
  }

  /** autoPlay holds the pad again, so the player's release leaves autoPlay's press alone. */
  autoPlayPressed(x: number, y: number): void {
    this.leftToPlayer.delete(this.key(x, y));
  }

  isHeld(x: number, y: number): boolean {
    return this.holds.has(this.key(x, y));
  }

  clear(): void {
    this.holds.clear();
    this.leftToPlayer.clear();
  }

  /** Calls `release` for every pad of the grid the player is not holding. */
  releaseOthers(buttonX: number, buttonY: number, release: (x: number, y: number) => void): void {
    for (let x = 0; x < buttonX; x++) {
      for (let y = 0; y < buttonY; y++) {
        if (this.isHeld(x, y)) this.leftToPlayer.add(this.key(x, y));
        else release(x, y);
      }
    }
  }
}
