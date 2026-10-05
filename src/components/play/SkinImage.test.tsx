import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkinImage } from './SkinImage';

const imgTag = (element: ReactElement) => renderToStaticMarkup(element).match(/<img [^>]*\/>/)?.[0];

for (const src of ['/theme/btn_.png', 'blob:https://unipad.io/0d6f2c1e-skin']) {
  test(`a skin layer draws ${src.split(':')[0]} pictures as a plain decorative image`, () => {
    assert.equal(
      imgTag(<SkinImage src={src} className="absolute inset-0 z-10" />),
      `<img src="${src}" class="absolute inset-0 z-10" alt="" draggable="false"/>`,
    );
  });
}

test('a skin logo keeps only the size its caller gives it', () => {
  assert.equal(
    imgTag(<SkinImage src="/theme/custom_logo.png" style={{ width: '90px' }} />),
    '<img src="/theme/custom_logo.png" style="width:90px" alt="" draggable="false"/>',
  );
});
