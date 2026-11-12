import { getTranslations } from 'next-intl/server';
import { DocsContentPage } from '@/components/docs/DocsContentPage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/docs/terms/privacy');

export default async function PrivacyPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'docs' });

  return (
    <DocsContentPage
      locale={locale}
      slug="terms/privacy"
      title={t('terms.privacy.title')}
      subtitle={t('terms.privacy.effectiveDate')}
      backHref="/docs/terms"
      backLabel={t('terms.title')}
    />
  );
}
