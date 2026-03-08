import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';

export default async function UsageScopePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-16">
      <Link
        href="/docs/terms"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ChevronLeft className="w-4 h-4" />
        Terms of Use
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold mb-8">앱 사용 범위 고지</h1>

      <div className="prose prose-neutral dark:prose-invert max-w-none">
        <p>
          UniPad 앱은 일반적인 앱 사용 범위 내에서 <strong>상업적 목적</strong> 및{' '}
          <strong>비상업적 목적</strong> 모두 사용이 가능합니다.
        </p>

        <h2>허용되는 사용 예시</h2>
        <ul>
          <li>수익 창출이 가능한 영상 촬영 및 업로드를 위한 목적</li>
          <li>입장료를 받거나 그러하지 않은 공연에서의 사용을 위한 목적</li>
          <li>유료 또는 무료 교육을 위한 목적</li>
        </ul>
      </div>
    </div>
  );
}
