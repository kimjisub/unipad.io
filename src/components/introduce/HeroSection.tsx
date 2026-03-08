'use client';

import { motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';

import { GradientText } from '@/components/GradientText';
import { TypewriterEffect } from '@/components/TypewriterEffect';
import { Link } from '@/i18n/navigation';

const heroContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.05,
    },
  },
};

const heroItemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

export const HeroSection = () => {
  const t = useTranslations('hero');

  return (
    <section className="min-h-[85vh] flex items-center relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-accent/3 via-transparent to-transparent" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 md:px-6 py-24 text-center">
        <motion.div
          className="flex flex-col items-center gap-6"
          variants={heroContainerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {/* Title */}
          <motion.div variants={heroItemVariants}>
            <h1 className="text-5xl md:text-7xl font-bold mb-2 tracking-tight">
              <GradientText duration={5}>
                UniPad
              </GradientText>
            </h1>
          </motion.div>

          {/* Tagline */}
          <motion.div variants={heroItemVariants}>
            <div className="text-xl md:text-2xl font-medium text-foreground/80">
              <TypewriterEffect
                texts={[
                  t('typewriter.0'),
                  t('typewriter.1'),
                  t('typewriter.2'),
                  t('typewriter.3'),
                ]}
                typingSpeed={75}
                deletingSpeed={40}
                pauseTime={2000}
              />
            </div>
          </motion.div>

          {/* Description */}
          <motion.div variants={heroItemVariants}>
            <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
              {t('description')}
            </p>
          </motion.div>

          {/* CTA */}
          <motion.div variants={heroItemVariants} className="flex flex-wrap gap-4 justify-center mt-4">
            <a
              href="https://play.google.com/store/apps/details?id=com.kimjisub.launchpad"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-xl bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors shadow-lg shadow-accent/20"
            >
              {t('downloadCta')}
            </a>
            <Link
              href="/docs"
              className="px-6 py-3 rounded-xl border border-border text-foreground hover:bg-muted transition-colors"
            >
              {t('viewDocs')}
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};
