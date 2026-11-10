'use client';

import { AnimatePresence, motion } from 'framer-motion';

/**
 * Bottom notice shared by the main and playback screens. The horizontal centering offset
 * is part of the animated transform: framer-motion writes `transform` inline, which would
 * drop a `-translate-x-1/2` class and leave the notice starting at the screen's middle.
 */
export function PlayToast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="fixed bottom-6 left-1/2 z-[80] w-max max-w-[calc(100vw-2rem)] px-4 py-2 rounded-2xl bg-black/80 text-xs text-center text-white border border-white/15"
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
