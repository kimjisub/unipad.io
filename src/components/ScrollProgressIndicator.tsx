'use client';

import { motion, useScroll, useSpring } from 'framer-motion';

const ScrollProgressIndicator: React.FC = () => {
  const { scrollYProgress } = useScroll();

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <>
      {/* Scroll progress bar — sits above TopBar (z-50) */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[3px] z-[60] origin-left"
        style={{
          scaleX,
          background:
            'linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 70%, white) 50%, var(--accent) 100%)',
        }}
      />

      {/* Glow layer */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[3px] z-[60] origin-left blur-[4px] opacity-60"
        style={{
          scaleX,
          background: 'var(--accent)',
        }}
      />
    </>
  );
};

export default ScrollProgressIndicator;
