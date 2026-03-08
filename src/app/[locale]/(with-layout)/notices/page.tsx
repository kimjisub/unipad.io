import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Calendar, Tag } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { getAllNoticePosts } from '@/data/notices';

export default async function NoticesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('notices');
  const posts = getAllNoticePosts();
  const lang = locale as 'en' | 'ko';

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-16">
      <h1 className="text-3xl md:text-4xl font-bold mb-4">{t('title')}</h1>
      <p className="text-muted-foreground mb-12 max-w-2xl">{t('subtitle')}</p>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">{t('noPosts')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/notices/${post.slug}`}
              className="p-6 rounded-2xl border border-border bg-card/30 hover:border-accent/30 transition-all group"
            >
              <h2 className="text-xl font-semibold text-foreground mb-2 group-hover:text-accent transition-colors">
                {post.title[lang]}
              </h2>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                {post.description[lang]}
              </p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {post.date}
                </span>
                <span>{post.author}</span>
                {post.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
