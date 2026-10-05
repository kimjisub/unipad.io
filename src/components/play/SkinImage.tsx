import Image, { type ImageProps } from 'next/image';

type SkinImageProps = Omit<ImageProps, 'alt' | 'unoptimized' | 'loading' | 'decoding' | 'draggable'>;

/**
 * A decorative picture from the active skin: a blob: URL read from the user's theme or UniPack zip,
 * or one of the small bundled defaults under /theme. It is drawn as-is (Next cannot optimize blob:
 * URLs) and loaded and decoded right away, because pads show it the moment they are pressed.
 */
export function SkinImage(props: SkinImageProps) {
  return <Image {...props} alt="" unoptimized loading="eager" decoding="auto" draggable={false} />;
}
