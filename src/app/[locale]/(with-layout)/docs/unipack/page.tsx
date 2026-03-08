import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

const pages = [
  { href: '/docs/unipack/info', title: 'info', emoji: '📄', description: 'UniPack의 기본 정보를 정의합니다.' },
  { href: '/docs/unipack/sounds', title: 'sounds', emoji: '📁', description: '사운드 파일을 저장하는 폴더입니다.' },
  { href: '/docs/unipack/key-sound', title: 'keySound', emoji: '📄', description: '사운드 파일을 버튼에 매핑합니다.' },
  { href: '/docs/unipack/key-led', title: 'keyLED', emoji: '📁', description: 'LED 이벤트 파일들을 관리합니다.' },
  { href: '/docs/unipack/auto-play', title: 'autoPlay', emoji: '📄', description: '자동 연주 및 연습 모드 데이터입니다.' },
];

export default async function UnipackDocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-16">
      <h1 className="text-3xl md:text-4xl font-bold mb-4">UniPack</h1>

      <div className="prose prose-neutral dark:prose-invert max-w-none mb-12">
        <p>
          <strong>UniPack</strong>은 UniPad의 프로젝트 파일로, <code>.zip</code> 포맷을 사용합니다.
          UniPack은 크게 <strong>5가지 파일</strong>로 구성됩니다.
        </p>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Format</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>info</td><td>📄 file</td><td>UniPack 설명 및 설정</td></tr>
            <tr><td>sounds</td><td>📁 folder</td><td>사운드 파일 폴더</td></tr>
            <tr><td>keySound</td><td>📄 file</td><td>버튼에 사운드 매핑</td></tr>
            <tr><td>keyLED</td><td>📁 folder</td><td>LED 이벤트 파일 폴더</td></tr>
            <tr><td>autoPlay</td><td>📄 file</td><td>자동 연주 녹음 데이터</td></tr>
          </tbody>
        </table>

        <div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
          <p className="font-semibold text-foreground mb-2">참고사항</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>사운드 파일을 제외한 파일에는 <strong>확장자가 없습니다</strong>.</li>
            <li>파일 포맷은 <strong>UTF-8</strong> (BOM 없음)을 사용합니다.</li>
            <li><strong>대소문자</strong>를 문서와 동일하게 맞춰주세요.</li>
            <li>수학 좌표계와 반대입니다. x축이 <strong>세로</strong>, y축이 <strong>가로</strong>입니다.</li>
            <li>시간 단위는 <strong>ms</strong>입니다.</li>
          </ul>
        </div>
      </div>

      <div className="grid gap-3">
        {pages.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className="flex items-center gap-4 p-4 rounded-xl border border-border hover:border-accent/30 transition-colors group"
          >
            <span className="text-2xl">{page.emoji}</span>
            <div>
              <h3 className="font-semibold text-foreground group-hover:text-accent transition-colors">
                {page.title}
              </h3>
              <p className="text-sm text-muted-foreground">{page.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
