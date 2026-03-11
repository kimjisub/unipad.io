import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function KeySoundPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="unipack/key-sound"
      title="keySound"
      backHref="/docs/unipack"
      backLabel="UniPack"
    />
  );
}
