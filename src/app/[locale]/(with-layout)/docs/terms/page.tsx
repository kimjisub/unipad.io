import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronLeft, Shield, AppWindow } from 'lucide-react';

const termPages = [
  {
    key: 'privacy' as const,
    href: '/docs/terms/privacy',
    icon: Shield,
  },
  {
    key: 'usage' as const,
    href: '/docs/terms/usage',
    icon: AppWindow,
  },
];

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('docs');

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-16">
      <Link
        href="/docs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ChevronLeft className="w-4 h-4" />
        {t('title')}
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold mb-4">{t('terms.title')}</h1>
      <p className="text-muted-foreground mb-12 max-w-2xl">
        {t('terms.intro')}
      </p>

      <div className="grid gap-4">
        {termPages.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className="flex items-center gap-4 p-5 rounded-xl border border-border bg-card/30 hover:border-accent/30 transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
              <page.icon className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground group-hover:text-accent transition-colors">
                {t(`terms.${page.key}.title`)}
              </h2>
              <p className="text-sm text-muted-foreground">{t(`terms.${page.key}.description`)}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
