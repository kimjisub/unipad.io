import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

export default async function KeyLEDPage({
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

			<h1 className="text-3xl md:text-4xl font-bold mb-8">keyLED</h1>

			<div className="prose prose-neutral dark:prose-invert max-w-none">
				<p>
					<code>keyLED</code> 폴더에는 LED 이벤트 파일들을 저장합니다.
					각 파일은 특정 버튼을 눌렀을 때 실행될 LED 애니메이션을 정의합니다.
				</p>

				<h2>파일명 구조</h2>

				<p>
					파일명은 다음 형식을 따릅니다:
				</p>

				<pre><code>{`keyLED/
├── c{chain}_{x}_{y}
└── ...

예시:
├── c1_1_1
├── c1_1_2
└── c2_3_4`}</code></pre>

				<table>
					<thead>
						<tr>
							<th>Part</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>c</code></td>
							<td>고정 접두사 (sequence character)</td>
						</tr>
						<tr>
							<td><code>chain</code></td>
							<td>체인 번호</td>
						</tr>
						<tr>
							<td><code>x</code></td>
							<td>버튼의 x 좌표 (세로)</td>
						</tr>
						<tr>
							<td><code>y</code></td>
							<td>버튼의 y 좌표 (가로)</td>
						</tr>
					</tbody>
				</table>

				<h2>이벤트 타입</h2>

				<h3>on - LED 켜기</h3>

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
							<td>type</td>
							<td>string</td>
							<td><code>on</code></td>
						</tr>
						<tr>
							<td>2</td>
							<td>x</td>
							<td>int</td>
							<td>LED x 좌표</td>
						</tr>
						<tr>
							<td>3</td>
							<td>y</td>
							<td>int</td>
							<td>LED y 좌표</td>
						</tr>
						<tr>
							<td>4</td>
							<td>color</td>
							<td>hex</td>
							<td>LED 색상 코드 (auto 가능)</td>
						</tr>
						<tr>
							<td>5</td>
							<td>velocity</td>
							<td>int</td>
							<td>Launchpad velocity 값 (선택)</td>
						</tr>
					</tbody>
				</table>

				<h3>off - LED 끄기</h3>

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
							<td>type</td>
							<td>string</td>
							<td><code>off</code></td>
						</tr>
						<tr>
							<td>2</td>
							<td>x</td>
							<td>int</td>
							<td>LED x 좌표</td>
						</tr>
						<tr>
							<td>3</td>
							<td>y</td>
							<td>int</td>
							<td>LED y 좌표</td>
						</tr>
					</tbody>
				</table>

				<h3>delay - 대기</h3>

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
							<td>type</td>
							<td>string</td>
							<td><code>delay</code></td>
						</tr>
						<tr>
							<td>2</td>
							<td>ms</td>
							<td>int</td>
							<td>대기 시간 (밀리초)</td>
						</tr>
					</tbody>
				</table>

				<h2>예시</h2>

				<pre><code>{`on 1 1 ff0000
on 1 2 00ff00
delay 100
off 1 1
off 1 2
delay 100
on 1 1 auto
delay 200
off 1 1`}</code></pre>

				<div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
					<p className="font-semibold text-foreground mb-2">참고사항</p>
					<ul className="list-disc list-inside text-muted-foreground space-y-1">
						<li><code>velocity</code>는 Launchpad 하드웨어에서 사용되는 값으로, 앱에서는 <code>color</code>가 우선 적용됩니다.</li>
						<li><code>color</code>에 <code>auto</code>를 사용하면 UniPad가 자동으로 색상을 지정합니다 (auto color mode).</li>
						<li>시간 단위는 <strong>ms (밀리초)</strong>입니다.</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
