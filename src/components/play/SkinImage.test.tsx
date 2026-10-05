import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkinImage } from './SkinImage';

for (const src of ['/theme/btn_.png', 'blob:https://unipad.io/0d6f2c1e-skin']) {
  test(`a skin layer draws ${src.split(':')[0]} pictures as-is and right away`, () => {
    const markup = renderToStaticMarkup(<SkinImage src={src} fill className="object-fill z-10" />);
    assert.match(markup, new RegExp(`<img [^>]*src="${src.replace(/[.]/g, '\\.')}"`));
    assert.doesNotMatch(markup, /_next\/image|srcSet|srcset/);
    assert.match(markup, /loading="eager"/);
    assert.match(markup, /decoding="auto"/);
    assert.match(markup, /alt=""/);
    assert.match(markup, /draggable="false"/);
    assert.match(markup, /position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0/);
  });
}

test('a sized skin logo keeps its own width and follows the picture height', () => {
  const markup = renderToStaticMarkup(
    <SkinImage src="/theme/custom_logo.png" width={90} height={0} style={{ width: '90px', height: 'auto' }} />,
  );
  assert.match(markup, /src="\/theme\/custom_logo\.png"/);
  assert.match(markup, /width:90px;height:auto/);
});
