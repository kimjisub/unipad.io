import { DocsContentPage } from '@/components/docs/DocsContentPage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/docs/unipack/sounds');

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
