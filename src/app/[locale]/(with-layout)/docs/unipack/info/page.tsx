import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

export default async function InfoPage({
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

			<h1 className="text-3xl md:text-4xl font-bold mb-8">info</h1>

			<div className="prose prose-neutral dark:prose-invert max-w-none">
				<p>
					<code>info</code> 파일은 UniPack의 기본 정보를 정의합니다. 각 줄은 <code>key=value</code> 형식으로 작성됩니다.
				</p>

				<h2>구조</h2>

				<table>
					<thead>
						<tr>
							<th>Key</th>
							<th>Type</th>
							<th>Required</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>title</code></td>
							<td>string</td>
							<td>Yes</td>
							<td>UniPack의 제목</td>
						</tr>
						<tr>
							<td><code>producerName</code></td>
							<td>string</td>
							<td>Yes</td>
							<td>제작자 이름</td>
						</tr>
						<tr>
							<td><code>buttonX</code></td>
							<td>int</td>
							<td>No</td>
							<td>가로 버튼 수 (기본값: 8)</td>
						</tr>
						<tr>
							<td><code>buttonY</code></td>
							<td>int</td>
							<td>No</td>
							<td>세로 버튼 수 (기본값: 8)</td>
						</tr>
						<tr>
							<td><code>chain</code></td>
							<td>int</td>
							<td>No</td>
							<td>체인 수 (기본값: 1)</td>
						</tr>
						<tr>
							<td><code>squareButton</code></td>
							<td>boolean</td>
							<td>No</td>
							<td>정사각형 버튼 사용 여부 (기본값: false)</td>
						</tr>
						<tr>
							<td><code>websiteURL</code></td>
							<td>string</td>
							<td>No</td>
							<td>관련 웹사이트 URL</td>
						</tr>
					</tbody>
				</table>

				<h2>예시</h2>

				<pre><code>{`title=My UniPack
producerName=UniPad
buttonX=8
buttonY=8
chain=8
squareButton=true
websiteURL=https://unipad.io`}</code></pre>

				<div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
					<p className="font-semibold text-foreground mb-2">참고사항</p>
					<ul className="list-disc list-inside text-muted-foreground space-y-1">
						<li><code>title</code>과 <code>producerName</code>은 필수 항목입니다.</li>
						<li>나머지 항목은 생략 시 기본값이 적용됩니다.</li>
						<li><code>squareButton</code>은 <code>true</code> 또는 <code>false</code>로 작성합니다.</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
