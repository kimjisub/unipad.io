import type { Locator } from '@playwright/test';
import { test, expect } from './browser';

test.use({ locale: 'ko-KR' });

/**
 * Draws two different Hangul syllables from the element's own text in the
 * element's computed font and reports whether they came out as distinct glyphs.
 * When no installed font has Hangul, every syllable becomes the same
 * missing-glyph box, so the text is present in the page but unreadable.
 */
function drawsDistinctHangul(element: Locator) {
  return element.evaluate(node => {
    const syllables = [...new Set(node.textContent?.match(/[가-힣]/g) ?? [])].slice(0, 2);
    if (syllables.length < 2) return false;
    const font = getComputedStyle(node).font.replace(/\d+(\.\d+)?px/, '48px');
    const draw = (text: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d')!;
      context.font = font;
      context.fillText(text, 4, 52);
      return canvas.toDataURL();
    };
    const blank = draw('');
    const [first, second] = syllables.map(draw);
    return first !== blank && second !== blank && first !== second;
  });
}

test('the app guide link opens a readable Korean get-started page', async ({ page }) => {
  await page.goto('/docs/get-started');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  const title = page.getByRole('heading', { level: 1, name: '시작하기' });
  const body = page.getByText('UniPad를 설치하고 첫 유니팩을 연주해 보세요.');
  await expect(title).toBeVisible();
  await expect(body).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'UniPad 받기' })).toBeVisible();
  expect(await page.locator('main').innerText(), 'replacement characters in the page text').not.toContain('�');
  expect(await drawsDistinctHangul(title), 'the title is drawn as missing-glyph boxes').toBe(true);
  expect(await drawsDistinctHangul(body), 'the body is drawn as missing-glyph boxes').toBe(true);
});
