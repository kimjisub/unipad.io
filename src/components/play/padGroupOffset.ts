export interface PadGroupLayout {
  /** Width of the whole play screen. */
  screenWidth: number;
  /** Where the pad stage starts, measured from the screen's left edge (after the menu strip). */
  stageLeft: number;
  stageWidth: number;
  padWidth: number;
  leftChainWidth: number;
  rightChainWidth: number;
}

/**
 * Distance from the pad stage's left edge to the left chain column (or the pads, without one).
 *
 * The pad grid sits on the screen's centre line, as on Android and iOS. It moves only as far as
 * needed to keep the chain columns inside the stage, clear of the menu strip on the left and of
 * the screen edge on the right.
 */
export function padGroupOffsetX({
  screenWidth,
  stageLeft,
  stageWidth,
  padWidth,
  leftChainWidth,
  rightChainWidth,
}: PadGroupLayout): number {
  const groupWidth = leftChainWidth + padWidth + rightChainWidth;
  const centred = screenWidth / 2 - stageLeft - padWidth / 2 - leftChainWidth;
  return Math.round(Math.max(0, Math.min(centred, stageWidth - groupWidth)));
}
