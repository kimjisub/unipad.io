import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function SoundsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="unipack/sounds"
      title="sounds/"
      backHref="/docs/unipack"
      backLabel="UniPack"
    />
  );
}
