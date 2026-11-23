import { getTranslations } from 'next-intl/server';
import { DocsContentPage } from '@/components/docs/DocsContentPage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/docs/guide');

export default async function GuidePage({
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
      slug="guide"
      title={t('guide.title')}
      subtitle={t('guide.description')}
      backHref="/docs"
      backLabel={tCommon('docs')}
    />
  );
}
