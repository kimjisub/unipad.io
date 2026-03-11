import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function InfoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="unipack/info"
      title="info"
      backHref="/docs/unipack"
      backLabel="UniPack"
    />
  );
}
