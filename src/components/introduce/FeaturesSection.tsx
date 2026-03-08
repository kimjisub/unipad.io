'use client';

import { useRef } from 'react';
import { motion, useInView, type Variants } from 'framer-motion';
import { Headphones, Share2, Usb, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

type FeatureKey = 'practice' | 'unipack' | 'integration';

const featureIcons: Record<FeatureKey, LucideIcon> = {
  practice: Headphones,
  unipack: Share2,
  integration: Usb,
};

const featureKeys: FeatureKey[] = ['practice', 'unipack', 'integration'];

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' },
  },
};

export const FeaturesSection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const t = useTranslations('features');

  return (
    <div className="py-24 border-t border-border" ref={ref}>
      <div className="max-w-5xl mx-auto px-4 md:px-6">
        <motion.h2
          className="font-serif text-2xl md:text-3xl text-foreground mb-4 text-center italic"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
        >
          {t('title')}
        </motion.h2>
        <motion.p
          className="text-muted-foreground text-center mb-12 max-w-xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {t('subtitle')}
        </motion.p>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {featureKeys.map((key) => {
            const Icon = featureIcons[key];
            return (
              <motion.div
                key={key}
                variants={itemVariants}
                className="p-6 rounded-2xl border border-border bg-card/30 backdrop-blur-sm hover:border-accent/30 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                  <Icon className="w-5 h-5 text-accent" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{t(`${key}.title`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`${key}.description`)}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
};
