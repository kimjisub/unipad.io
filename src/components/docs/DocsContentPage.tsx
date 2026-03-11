import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';
import { loadMdxContent } from '@/lib/mdx';
import { MdxContent } from './MdxContent';

interface DocsContentPageProps {
  locale: string;
  slug: string;
  title: string;
  subtitle?: string;
  backHref: string;
  backLabel: string;
}

export async function DocsContentPage({
  locale,
  slug,
  title,
  subtitle,
  backHref,
  backLabel,
}: DocsContentPageProps) {
  setRequestLocale(locale);
  const source = loadMdxContent(locale, slug);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-16">
      <Link
        href={backHref}
        className="text-sm text-muted-foreground hover:text-accent transition-colors mb-6 inline-block"
      >
        &larr; {backLabel}
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold mb-2">{title}</h1>
      {subtitle && (
        <p className="text-muted-foreground mb-8">{subtitle}</p>
      )}
      {!subtitle && <div className="mb-8" />}

      <div className="prose prose-invert max-w-none">
        <MdxContent source={source} />
      </div>
    </div>
  );
}
