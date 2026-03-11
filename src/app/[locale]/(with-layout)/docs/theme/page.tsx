import { DocsContentPage } from '@/components/docs/DocsContentPage';

export default async function ThemePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <DocsContentPage
      locale={locale}
      slug="theme"
      title="Theme"
      backHref="/docs"
      backLabel="Docs"
    />
  );
}
