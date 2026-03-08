import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

export default async function KeySoundPage({
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

			<h1 className="text-3xl md:text-4xl font-bold mb-8">keySound</h1>

			<div className="prose prose-neutral dark:prose-invert max-w-none">
				<p>
					<code>keySound</code> 파일은 사운드 파일을 버튼에 매핑합니다.
					각 줄에 하나의 매핑을 정의하며, 공백으로 구분합니다.
				</p>

				<h2>구조</h2>

				<table>
					<thead>
						<tr>
							<th>Index</th>
							<th>Name</th>
							<th>Type</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>1</td>
							<td>chain</td>
							<td>int</td>
							<td>체인 번호</td>
						</tr>
						<tr>
							<td>2</td>
							<td>x</td>
							<td>int</td>
							<td>버튼의 x 좌표 (세로)</td>
						</tr>
						<tr>
							<td>3</td>
							<td>y</td>
							<td>int</td>
							<td>버튼의 y 좌표 (가로)</td>
						</tr>
						<tr>
							<td>4</td>
							<td>filename</td>
							<td>string</td>
							<td>사운드 파일명 (sounds 폴더 내)</td>
						</tr>
						<tr>
							<td>5</td>
							<td>repeat</td>
							<td>int</td>
							<td>반복 횟수 (기본값: 1)</td>
						</tr>
						<tr>
							<td>6</td>
							<td>wormhole</td>
							<td>int</td>
							<td>사운드 재생 후 이동할 체인 번호</td>
						</tr>
					</tbody>
				</table>

				<h2>예시</h2>

				<pre><code>{`1 1 1 kick.wav
1 1 2 snare.wav
1 1 3 hat.wav
2 1 1 bass.wav 2
2 1 2 lead.wav 1 3`}</code></pre>

				<h2>하나의 버튼에 여러 사운드 매핑</h2>

				<p>
					같은 체인, x, y에 여러 사운드를 매핑하면, 버튼을 누를 때마다 순서대로 재생됩니다.
				</p>

				<pre><code>{`1 1 1 sound1.wav
1 1 1 sound2.wav
1 1 1 sound3.wav`}</code></pre>

				<div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
					<p className="font-semibold text-foreground mb-2">참고사항</p>
					<ul className="list-disc list-inside text-muted-foreground space-y-1">
						<li><code>repeat</code>과 <code>wormhole</code>은 선택 항목입니다.</li>
						<li><code>wormhole</code>을 사용하면 사운드 재생 후 지정된 체인으로 자동 이동합니다.</li>
						<li>하나의 버튼에 여러 사운드를 매핑하면 누를 때마다 순서대로 재생됩니다.</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
