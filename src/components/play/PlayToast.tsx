'use client';

import { AnimatePresence, motion } from 'framer-motion';

interface PlayToastProps {
  message: string | null;
  /** Width in px taken by a sheet on the right edge (the open menu); the notice centres in the space left of it. */
  rightInset?: number;
}

/**
 * Bottom notice shared by the main and playback screens. The horizontal centering offset
 * is part of the animated transform: framer-motion writes `transform` inline, which would
 * drop a `-translate-x-1/2` class and leave the notice starting at the screen's middle.
 * It sits above the Launchpad settings dialog (85) so a notice raised from it stays readable,
 * and below the portrait rotation hint (90).
 */
export function PlayToast({ message, rightInset = 0 }: PlayToastProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="fixed bottom-6 z-[88] w-max px-4 py-2 rounded-2xl bg-black/80 text-xs text-center text-white border border-white/15"
          style={{ left: `calc(50% - ${rightInset / 2}px)`, maxWidth: `calc(100% - ${rightInset}px - 2rem)` }}
          initial={{ opacity: 0, x: '-50%', y: 10, scale: 0.97 }}
          animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
          exit={{ opacity: 0, x: '-50%', y: 8, scale: 0.98 }}
          transition={{ duration: 0.2 }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
