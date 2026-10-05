// 보존 출력만 대조한다. 앱, 파서, 소리·불빛 실행기를 새로 실행하지 않는다.
// 사용: node audit.mjs <근거 묶음을 푼 폴더>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const root = process.argv[2];
assert(root, '근거 폴더가 필요합니다');
const bytes = (name) => readFileSync(join(root, name));
const json = (name) => JSON.parse(bytes(name));
const sha256 = (name) => createHash('sha256').update(bytes(name)).digest('hex');
const corpus = json('corpus.json');
const original = json('divergences-original.json');
assert.equal(sha256('corpus.json'), '30ad4442b7abf40ee0cbfcc97976999fbde4571b30f1d39590425620e4c465eb');
assert.equal(sha256('divergences-original.json'), '145f0b60eff09e290e07945b12cc21dc0cfb011eb7b0623fa0f460af0e0a1ca5');
const parser = bytes('parser.ts').toString();
const harness = bytes('conformanceHarness.ts').toString();
assert.equal(sha256('parser.ts'), '43b0423e78fde25f90d153337ca99e411a1df7b52f013185f855f817ad82bf0a');
assert.equal(sha256('conformanceHarness.ts'), '01f719ae32ca02330095a5867f32d122798b6d2233abe212111e9f2c9e509950');

// 원래 함수의 본문을 그대로 평가한다. 검사 도구를 고치거나 대체하지 않는다.
const strictBody = /function strictInt\(token: string \| undefined\): number \{([\s\S]*?)\n\}/.exec(parser)?.[1];
const normalizeBody = /export function normalizeError\(message: string\): string \{([\s\S]*?)\n\}/.exec(harness)?.[1];
assert(strictBody && normalizeBody, '지정 소스에서 함수 본문을 찾을 수 없음');
const strictInt = runInNewContext(`(function(token) {${strictBody}})`);
const normalizeError = runInNewContext(`(function(message) {${normalizeBody.replace('let kind: string;', 'let kind;')}})`);
const lineOf = (needle) => {
  const index = parser.indexOf(needle);
  assert(index >= 0, `경고 경로가 없음: ${needle}`);
  return parser.slice(0, index).split('\n').length;
};
const withoutErrors = (value) => {
  const result = { ...value };
  delete result.errors;
  return result;
};
const byId = new Map(corpus.cases.map((c) => [c.id, c]));
const ids = [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 11].map((n) => `AP-M${String(n).padStart(2, '0')}`),
  ...[1, 2, 3, 4, 5].map((n) => `KL-N${String(n).padStart(2, '0')}`)];
const platforms = {};
for (const platform of ['web', 'android', 'ios']) {
  const result = json(`${platform}.json`);
  assert.equal(result.platform, platform);
  assert.equal(result.corpusSha256, sha256('corpus.json'));
  assert.equal(result.assertions, 'checked');
  assert.equal(new Set(result.cases.map((r) => r.id)).size, result.cases.length);
  platforms[platform] = { result, rows: new Map(result.cases.map((r) => [r.id, r])) };
}

const rows = ids.map((id) => {
  const c = byId.get(id);
  assert.equal(c.layer, 'parse');
  assert.equal(c.expectation, 'determined');
  const outputs = {};
  for (const [platform, { rows }] of Object.entries(platforms)) {
    const r = rows.get(id);
    assert.equal(r.fingerprint, c.fingerprint);
    assert.deepEqual(withoutErrors(r.actual), withoutErrors(c.expected), `${id} ${platform}: 경고 외 출력이 다름`);
    assert.deepEqual(withoutErrors(r.actual), withoutErrors(original[id].web.actual));
    assert.deepEqual(r.actual.errors, [`${id.startsWith('AP') ? 'autoPlay' : 'keyLed'}:${platform === 'web' ? 'range' : 'format'}`]);
    assert.equal(r.status, platform === 'web' ? 'fail' : 'pass');
    outputs[platform] = r;
  }
  assert.deepEqual(outputs.web.actual, original[id].web.actual);
  const section = id.startsWith('AP') ? 'autoPlay' : 'keyLed';
  const file = c.files.find((f) => section === 'autoPlay' ? f.path === 'autoPlay' : f.path.startsWith('keyLed/'));
  const input = section === 'autoPlay' ? file.text.split('\n')[0] : file.path.slice('keyLed/'.length);
  const tokens = input.split(/\s+/);
  const field = section === 'keyLed' ? ['chain', 'x', 'y', 'loop', 'loop'][Number(id.slice(-2)) - 1]
    : ['chain', 'delay'].includes(tokens[0]) ? tokens[0] : 'coordinate';
  const indexes = section === 'keyLed' ? [Number(id.slice(-2)) <= 3 ? Number(id.slice(-2)) - 1 : 3]
    : field === 'coordinate' ? [1, 2] : [1];
  const invalid = indexes.filter((index) => Number.isNaN(strictInt(tokens[index])));
  assert(invalid.length > 0, `${id}: 숫자 형식 오류를 확인하지 못함`);
  const template = `${section}: [\${${section === 'autoPlay' ? 'trimmed' : 'fileName'}}] ${field} is incorrect`;
  const rawWarning = `${section}: [${input}] ${field} is incorrect`;
  const sourceLine = lineOf(template);
  assert.equal(normalizeError(rawWarning), outputs.web.actual.errors[0]);
  return {
    사례: id, 입력파일: file, 입력지문: c.fingerprint,
    원문경고: rawWarning, 원문경고근거: '보존 출력에는 분류만 있음. 지정 소스의 문장에서 복원함. 새 파서 실행 결과가 아님.',
    분류경로: { 함수: section === 'autoPlay' ? 'parseAutoPlay' : 'parseKeyLed', 필드: field,
      실패토큰: invalid.map((index) => ({ 위치: index, 값: tokens[index] ?? null, 이유: tokens[index] === undefined ? '값 누락' : '완전한 정수가 아님' })),
      파서줄: sourceLine, 검사도구줄: harness.slice(0, harness.indexOf("else if (/\\b(chain|x|y|loop|coordinate|delay)")).split('\n').length,
      보존분류: normalizeError(rawWarning) },
    경고외동일: true, 경고외출력: withoutErrors(outputs.web.actual), 플랫폼별보존출력: outputs,
    연주영향: section === 'autoPlay' ? '잘못된 첫 줄이 빠지고 on 1 1만 남음. 소리 두 개와 빈 불빛 목록이 세 플랫폼에서 같음. 실제 재생·청취는 미확인.'
      : '잘못된 이름의 파일 전체가 빠짐. 소리 하나는 남고 불빛 목록은 비며 자동 연주는 없음. 세 플랫폼에서 같음. 실제 재생·청취는 미확인.',
    원문으로구분: '이 15종은 대괄호 안 입력과 필드·명령을 같이 읽으면 숫자 형식 실패를 확인할 수 있음. 문장 끝만으로는 정보 부족.',
    수정범위: '검사 도구에 입력·필드 근거를 보존하는 좁은 분류 보완 검토. 제품 진단 변경은 이 15종의 분류에 필수 아님.',
    보류이유: '이번은 조사만 수행. 연주 변경 근거 없음. 문장 끝 전체를 형식으로 바꾸면 실제 범위 오류도 바뀜. 불명확한 입력은 정보 부족으로 남겨야 함.',
  };
});

// 같은 문장 끝이어도 실제로 범위가 잘못된 정수는 현재 범위 분류를 유지한다.
const controls = ['autoPlay: [on 5 1] coordinate is incorrect', 'autoPlay: [chain 3] chain is incorrect',
  'keyLed: [3 1 1] chain is incorrect', 'keyLed: [1 5 1] x is incorrect', 'keyLed: [1 1 1 -1] loop is incorrect'];
for (const warning of controls) assert(warning.endsWith('is incorrect') && normalizeError(warning).endsWith(':range'));
for (const id of ['KL-003', 'AP-004']) {
  assert.equal(byId.get(id).expectation, 'undetermined');
  assert.equal(byId.get(id).expected, undefined);
  for (const { rows } of Object.values(platforms)) assert.equal(rows.get(id).status, 'unverified');
}
const output = {
  조사종류: '보존 출력과 지정 소스의 읽기 전용 대조', 새기기실행: false, 실제사용자영향인원: null,
  기준: json('revisions.json'),
  파일지문: Object.fromEntries(['corpus.json', 'divergences-original.json', 'parser.ts', 'conformanceHarness.ts', 'web.json', 'android.json', 'ios.json'].map((f) => [f, sha256(f)])),
  보존시각: Object.fromEntries(Object.entries(platforms).map(([p, { result }]) => [p, result.generatedAt])),
  검사결과: { 사례수: rows.length, 경고외동일: rows.length, 원문입력에서형식실패확인: rows.length, 범위경고대조수: controls.length, 경고미결정유지: ['KL-003', 'AP-004'] },
  실제범위오류문장대조: controls, 사례: rows,
};
console.log(JSON.stringify(output, null, 2));
