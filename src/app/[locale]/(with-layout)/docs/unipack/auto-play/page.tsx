import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function AutoPlayPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="unipack/auto-play"
      title="autoPlay"
      backHref="/docs/unipack"
      backLabel="UniPack"
    />
  );
}
