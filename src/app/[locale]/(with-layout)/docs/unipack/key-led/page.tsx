import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function KeyLEDPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="unipack/key-led"
      title="keyLED/"
      backHref="/docs/unipack"
      backLabel="UniPack"
    />
  );
}
