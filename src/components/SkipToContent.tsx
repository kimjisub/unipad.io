'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

interface SkipLink {
  id: string;
  labelKey: 'skipToContent' | 'skipToNav';
}

const skipLinks: SkipLink[] = [
  { id: 'main-content', labelKey: 'skipToContent' },
  { id: 'navigation', labelKey: 'skipToNav' },
];

export function SkipToContent() {
  const [focused, setFocused] = useState(false);
  const t = useTranslations('common');

  const handleClick = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return (
    <div
      className={`
        fixed top-0 left-0 z-[9999] p-2
        transition-transform duration-200
        ${focused ? 'translate-y-0' : '-translate-y-full'}
      `}
    >
      <nav aria-label={t('skipToContent')} className="flex flex-col gap-1">
        {skipLinks.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            onClick={(e) => {
              e.preventDefault();
              handleClick(link.id);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="
              px-4 py-2 rounded-lg
              bg-accent text-accent-foreground
              font-medium text-sm
              focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
              shadow-lg
            "
          >
            {t(link.labelKey)}
          </a>
        ))}
      </nav>
    </div>
  );
}
