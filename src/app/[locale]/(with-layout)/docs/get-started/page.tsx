import { getTranslations } from 'next-intl/server';
import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function GetStartedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'docs' });
  const tCommon = await getTranslations({ locale, namespace: 'common' });

  return (
    <DocsContentPage
      locale={locale}
      slug="get-started"
      title={t('getStarted.title')}
      subtitle={t('getStarted.description')}
      backHref="/docs"
      backLabel={tCommon('docs')}
    />
  );
}
