import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

export default async function SoundsPage({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	setRequestLocale(locale);

	return (
		<div className="max-w-4xl mx-auto px-4 md:px-6 py-16">
			<Link
				href="/docs/unipack"
				className="text-sm text-muted-foreground hover:text-accent transition-colors mb-6 inline-block"
			>
				&larr; UniPack
			</Link>

			<h1 className="text-3xl md:text-4xl font-bold mb-8">sounds</h1>

			<div className="prose prose-neutral dark:prose-invert max-w-none">
				<p>
					<code>sounds</code> 폴더에는 UniPack에서 사용하는 사운드 파일들을 저장합니다.
				</p>

				<h2>파일 형식</h2>

				<ul>
					<li>확장자: <code>.wav</code></li>
					<li>권장 포맷: <strong>PCM 16bit</strong></li>
					<li>파일명에는 <strong>영문자와 숫자</strong>만 사용할 수 있습니다.</li>
					<li>재생 시간은 약 <strong>6초</strong>까지 지원됩니다.</li>
				</ul>

				<h2>예시</h2>

				<pre><code>{`sounds/
├── 1.wav
├── 2.wav
├── 3.wav
├── kick.wav
├── snare.wav
└── hat.wav`}</code></pre>

				<div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
					<p className="font-semibold text-foreground mb-2">참고사항</p>
					<ul className="list-disc list-inside text-muted-foreground space-y-1">
						<li>파일명에 한글이나 특수문자를 사용하면 인식되지 않을 수 있습니다.</li>
						<li>PCM 16bit 외의 포맷은 일부 기기에서 호환성 문제가 발생할 수 있습니다.</li>
						<li>6초를 초과하는 사운드 파일은 잘릴 수 있습니다.</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
