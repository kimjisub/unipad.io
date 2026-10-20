import { getTranslations } from 'next-intl/server';
import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function UsageScopePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'docs' });

  return (
    <DocsContentPage
      locale={locale}
      slug="terms/usage"
      title={t('terms.usage.title')}
      backHref="/docs/terms"
      backLabel={t('terms.title')}
    />
  );
}
