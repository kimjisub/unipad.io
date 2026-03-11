import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function UsageScopePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="terms/usage"
      title="앱 사용 범위 고지"
      backHref="/docs/terms"
      backLabel="Terms of Use"
    />
  );
}
