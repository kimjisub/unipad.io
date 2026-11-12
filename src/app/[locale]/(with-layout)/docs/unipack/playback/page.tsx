import { DocsContentPage } from '@/components/docs/DocsContentPage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/docs/unipack/playback');

export default async function PlaybackDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <DocsContentPage locale={locale} slug="unipack/playback" title={locale === 'ko' ? '연주 동작 기준' : 'Playback behavior'} backHref="/docs/unipack" backLabel="UniPack" />;
}
