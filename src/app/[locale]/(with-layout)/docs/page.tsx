import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BookOpen, Music, Palette, Rocket, Shield } from 'lucide-react';

import { GET_STARTED_PATH } from '@/lib/constants';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/docs');

const docSections = [
  {
    titleKey: 'getStarted.title' as const,
    descriptionKey: 'getStarted.description' as const,
    href: GET_STARTED_PATH,
    icon: Rocket,
  },
  {
    titleKey: 'unipack.title' as const,
    descriptionKey: 'unipack.description' as const,
    href: '/docs/unipack',
    icon: Music,
  },
  {
    titleKey: 'theme.title' as const,
    descriptionKey: 'theme.description' as const,
    href: '/docs/theme',
    icon: Palette,
  },
  {
    titleKey: 'terms.title' as const,
    descriptionKey: 'terms.description' as const,
    href: '/docs/terms',
    icon: Shield,
  },
];

export default async function DocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('docs');

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-16">
      <h1 className="text-3xl md:text-4xl font-bold mb-4">{t('title')}</h1>
      <p className="text-muted-foreground mb-12 max-w-2xl">
        {t('subtitle')}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="md:col-span-2 p-6 rounded-2xl border border-accent/30 bg-card/30">
          <Link href="/docs/guide" aria-label={t('guide.title')} className="group block">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <BookOpen className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">{t('guide.title')}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{t('guide.description')}</p>
          </Link>
          <div className="mt-5 flex flex-wrap gap-2">
            {(['skins', 'web', 'launchpad', 'custom-firmware', 'faq'] as const).map((topic) => (
              <Link key={topic} href={`/docs/guide#${topic}`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-accent/50 hover:text-accent transition-colors">
                {t(`guide.topics.${topic}`)}
              </Link>
            ))}
          </div>
        </section>
        {docSections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="p-6 rounded-2xl border border-border bg-card/30 hover:border-accent/30 transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <section.icon className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">{t(section.titleKey)}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{t(section.descriptionKey)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
