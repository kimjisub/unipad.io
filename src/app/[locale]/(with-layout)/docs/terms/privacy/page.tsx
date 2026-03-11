import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function PrivacyPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="terms/privacy"
      title="Privacy Policy"
      subtitle="Effective date: October 03, 2018"
      backHref="/docs/terms"
      backLabel="Terms of Use"
    />
  );
}
