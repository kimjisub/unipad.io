import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChainBar } from './ChainBar';

const sides = [
  { name: 'top', rangeStart: 0, rangeEnd: 8, orientation: 'horizontal' as const, reversed: false,
    labels: [1, 2, 3, 4, 5, 6, 7, 8] },
  { name: 'right', rangeStart: 8, rangeEnd: 16, orientation: 'vertical' as const, reversed: false,
    labels: [9, 10, 11, 12, 13, 14, 15, 16] },
  { name: 'bottom', rangeStart: 16, rangeEnd: 24, orientation: 'horizontal' as const, reversed: true,
    labels: [24, 23, 22, 21, 20, 19, 18, 17] },
  { name: 'left', rangeStart: 24, rangeEnd: 32, orientation: 'vertical' as const, reversed: true,
    labels: [32, 31, 30, 29, 28, 27, 26, 25] },
];

function renderSide(side: typeof sides[number], slotCount: number, proLightMode: boolean, chainCount = 32) {
  return renderToStaticMarkup(
    <ChainBar
      {...side}
      slotCount={slotCount}
      chainCount={chainCount}
      chainStates={[]}
      currentChain={31}
      theme={null}
      proLightMode={proLightMode}
      onChainSelect={() => {}}
    />,
  );
}

function labels(markup: string) {
  return Array.from(markup.matchAll(/aria-label="Chain (\d+)"/g), (match) => Number(match[1]));
}

for (const proLightMode of [false, true]) {
  for (const side of sides) {
    test(`${side.name} preserves all eight circle positions with Pro Light Mode ${proLightMode}`, () => {
      // Covers INF-002's 4-row vertical and 3-column horizontal bars, the 8x8 baseline,
      // and every smaller accepted pad dimension. Render the real component, not a copy of its math.
      for (let slotCount = 1; slotCount <= 8; slotCount++) {
        const markup = renderSide(side, slotCount, proLightMode);
        assert.deepEqual(labels(markup), side.labels, `pad dimension ${slotCount}`);
        assert.equal((markup.match(/12\.5%/g) ?? []).length, 8, 'positions share the same strip');
      }
    });
  }

  test(`INF-002 exposes its final chain at circle index 31 with Pro Light Mode ${proLightMode}`, () => {
    const left = renderSide(sides[3], 4, proLightMode);
    assert.ok(labels(left).includes(32));
    assert.match(left, /aria-label="Chain 32"[^]*?background-color:rgba\(255,255,255,0\.10\)/);
    const right = renderSide(sides[1], 4, proLightMode);
    const bottom = renderSide(sides[2], 3, proLightMode);
    assert.deepEqual([...labels(right), ...labels(bottom), ...labels(left)].sort((a, b) => a - b),
      Array.from({ length: 24 }, (_, i) => i + 9));
  });
}

test('positions outside chainCount remain placeholders in a reversed strip', () => {
  assert.deepEqual(labels(renderSide(sides[3], 4, false, 26)), [26, 25]);
});

test('an omitted slotCount keeps the default eight-position strip', () => {
  const markup = renderToStaticMarkup(
    <ChainBar chainCount={32} chainStates={[]} currentChain={8} theme={null} onChainSelect={() => {}} />,
  );
  assert.deepEqual(labels(markup), sides[0].labels);
});
