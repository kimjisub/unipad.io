import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

const pages = [
  { href: '/docs/unipack/info', title: 'info', emoji: '📄', description: 'UniPack의 메타데이터를 정의하는 필수 파일' },
  { href: '/docs/unipack/sounds', title: 'sounds/', emoji: '📁', description: '사운드 파일을 저장하는 폴더' },
  { href: '/docs/unipack/key-sound', title: 'keySound', emoji: '📄', description: '버튼과 사운드 파일의 매핑을 정의하는 필수 파일' },
  { href: '/docs/unipack/key-led', title: 'keyLED/', emoji: '📁', description: 'LED 애니메이션 파일을 저장하는 폴더 (선택)' },
  { href: '/docs/unipack/auto-play', title: 'autoPlay', emoji: '📄', description: '자동 연주 시퀀스를 정의하는 파일 (선택)' },
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
      <Link
        href="/docs"
        className="text-sm text-muted-foreground hover:text-accent transition-colors mb-6 inline-block"
      >
        &larr; Docs
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold mb-4">UniPack</h1>

      <div className="prose prose-invert max-w-none mb-12">
        <p>
          <strong>UniPack</strong>은 UniPad의 프로젝트 파일 포맷입니다.
          ZIP 아카이브로 배포되며, 내부에 사운드, LED 애니메이션, 자동 연주 데이터를 포함합니다.
        </p>

        <h2>디렉토리 구조</h2>

        <pre><code>{`unipack.zip
├── info              (필수)  메타데이터
├── keySound          (필수)  버튼-사운드 매핑
├── sounds/           (필수)  사운드 파일 폴더
│   ├── kick.wav
│   ├── snare.wav
│   └── ...
├── keyLED/           (선택)  LED 애니메이션 폴더
│   ├── 1 1 1
│   ├── 1 2 1
│   └── ...
└── autoPlay          (선택)  자동 연주 시퀀스`}</code></pre>

        <div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
          <p className="font-semibold text-foreground mb-2">기본 규칙</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li><code>info</code>와 <code>keySound</code> 파일이 없으면 UniPack을 로드할 수 없습니다.</li>
            <li>파일명은 <strong>대소문자를 구분하지 않습니다</strong> (info, INFO, Info 모두 인식).</li>
            <li>텍스트 파일의 인코딩은 <strong>UTF-8</strong>을 사용합니다.</li>
            <li>좌표는 모두 <strong>1-indexed</strong>입니다 (1부터 시작).</li>
            <li>시간 단위는 <strong>밀리초(ms)</strong>입니다.</li>
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
