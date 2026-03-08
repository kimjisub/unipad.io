import { Link } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

export default async function AutoPlayPage({
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

			<h1 className="text-3xl md:text-4xl font-bold mb-8">autoPlay</h1>

			<div className="prose prose-neutral dark:prose-invert max-w-none">
				<p>
					<code>autoPlay</code> 파일은 자동 연주 녹음 데이터를 저장합니다.
					연습 모드에서도 이 데이터가 사용됩니다.
				</p>

				<h2>이벤트 타입</h2>

				<table>
					<thead>
						<tr>
							<th>Type</th>
							<th>Parameters</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>chain</code></td>
							<td>chain_number</td>
							<td>체인 변경</td>
						</tr>
						<tr>
							<td><code>on</code></td>
							<td>x y</td>
							<td>버튼 누름</td>
						</tr>
						<tr>
							<td><code>off</code></td>
							<td>x y</td>
							<td>버튼 떼기</td>
						</tr>
						<tr>
							<td><code>touch</code></td>
							<td>x y</td>
							<td>버튼 누름 + 떼기 동시 처리</td>
						</tr>
						<tr>
							<td><code>delay</code></td>
							<td>ms</td>
							<td>대기 시간 (밀리초)</td>
						</tr>
					</tbody>
				</table>

				<h2>예시</h2>

				<pre><code>{`chain 1
on 1 1
on 1 2
delay 100
off 1 1
off 1 2
delay 200
touch 2 1
touch 2 2
delay 100
chain 2
on 1 1
delay 500
off 1 1`}</code></pre>

				<div className="rounded-xl border border-border bg-card/30 p-4 text-sm not-prose">
					<p className="font-semibold text-foreground mb-2">참고사항</p>
					<ul className="list-disc list-inside text-muted-foreground space-y-1">
						<li><code>touch</code>는 <code>on</code>과 <code>off</code>를 동시에 처리합니다. 버튼을 누르고 바로 떼는 경우에 사용합니다.</li>
						<li>동시에 눌리는 버튼들은 <code>delay</code> 없이 연속으로 작성합니다. 20ms 이내의 간격은 동시 터치로 처리됩니다.</li>
						<li><code>chain</code> 이벤트를 사용하여 체인을 변경할 수 있습니다.</li>
						<li>시간 단위는 <strong>ms (밀리초)</strong>입니다.</li>
					</ul>
				</div>
			</div>
		</div>
	);
}
