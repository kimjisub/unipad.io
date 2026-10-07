import type { Locator } from '@playwright/test';
import { test, expect } from './browser';

test.use({ locale: 'ko-KR' });

/**
 * For every element in the region whose own text has at least two different
 * Hangul syllables, draws two of them in that element's computed font and
 * checks they come out as distinct glyphs. When the font has no Hangul, every
 * syllable becomes the same missing-glyph box, so the text is present in the
 * page but unreadable. Returns the text of the checked elements and of those
 * drawn as boxes.
 */
function hangulGlyphs(region: Locator) {
  return region.evaluate(root => {
    const draw = (font: string, text: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      context.font = font;
      context.fillText(text, 4, 52);
      return canvas.toDataURL();
    };
    const checked: string[] = [];
    const boxes: string[] = [];
    for (const element of [root, ...root.querySelectorAll('*')]) {
      const ownText = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join('')
        .trim();
      const syllables = [...new Set(ownText.match(/[가-힣]/g) ?? [])].slice(0, 2);
      if (syllables.length < 2) continue;
      const font = getComputedStyle(element).font.replace(/\d+(\.\d+)?px/, '48px');
      const blank = draw(font, '');
      const [first, second] = syllables.map(syllable => draw(font, syllable));
      checked.push(ownText);
      if (first === blank || second === blank || first === second) boxes.push(ownText);
    }
    return { checked, boxes };
  });
}

test('the app guide link opens a readable Korean get-started page', async ({ page }) => {
  await page.goto('/docs/get-started');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  const intro = 'UniPad를 설치하고 첫 유니팩을 연주해 보세요.';
  await expect(page.getByRole('heading', { level: 1, name: '시작하기' })).toBeVisible();
  await expect(page.getByText(intro)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'UniPad 받기' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '첫 팩 연주하기' })).toBeVisible();

  const main = page.locator('main');
  expect(await main.innerText(), 'replacement characters in the page text').not.toContain('�');
  const { checked, boxes } = await hangulGlyphs(main);
  expect(checked, 'the title, intro and guide text are checked').toEqual(
    expect.arrayContaining(['시작하기', intro, 'UniPad 받기', '첫 팩 연주하기']),
  );
  expect(boxes, 'Korean text drawn as missing-glyph boxes').toEqual([]);
});
