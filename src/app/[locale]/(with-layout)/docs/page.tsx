import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Music, Shield } from 'lucide-react';

const docSections = [
  {
    titleKey: 'unipack.title' as const,
    descriptionKey: 'unipack.description' as const,
    href: '/docs/unipack',
    icon: Music,
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
