import type { ComponentProps } from 'react';

type SkinImageProps = Omit<ComponentProps<'img'>, 'alt' | 'draggable'>;

/**
 * A decorative picture from the active skin: a blob: URL read from the user's theme or UniPack zip,
 * or one of the small bundled defaults under /theme. It is a plain <img> on purpose: next/image
 * cannot resize blob: URLs, and pads redraw every frame while a guide animation runs, so the
 * component would only add work per pad and per frame.
 */
export function SkinImage(props: SkinImageProps) {
  // eslint-disable-next-line @next/next/no-img-element -- see above: skin pictures cannot be optimized and redraw every frame.
  return <img {...props} alt="" draggable={false} />;
}
