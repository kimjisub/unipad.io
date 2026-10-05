/**
 * What the recorded steps amount to, per feature. `null` means the profile does not exercise the feature.
 * Rotation passes when the rotate hint shows in portrait only and the pad grid is still there afterwards.
 */
export function checksOf(profile, steps) {
  const press = steps.padPress ?? {};
  const rotate = steps.rotate;
  const portraitFirst = profile.first[1] > profile.first[0];
  return {
    open_pack: steps.packOpened.pads > 0,
    sound: ((press.soundStarts ?? 0) > 0 && press.contextState === 'running') ||
      (rotate?.pressedAfterRotate === true && rotate.soundStartsAfter > rotate.soundStartsBefore &&
        rotate.contextStateAfterRotate === 'running'),
    led: (press.litWhileHeld ?? 0) > 0 || (rotate?.litWhileHeldAfterRotate ?? 0) > 0,
    rotation: rotate
      ? rotate.portraitHintVisibleBefore === portraitFirst &&
        rotate.portraitHintVisibleAfter === !portraitFirst &&
        rotate.padsAfter.pads === steps.packOpened.pads
      : null,
  };
}

export function isLocalRequest(url, base) {
  try {
    const target = new URL(url);
    if (target.protocol === 'data:') return true;
    return target.origin === new URL(base).origin;
  } catch {
    return false;
  }
}
