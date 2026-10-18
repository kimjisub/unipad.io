import type { Page } from '@playwright/test';
import { expect } from './browser';

export const padGrid = (page: Page) => page.evaluate(() => {
  const pads = [...document.querySelectorAll('[data-pad]')].map(pad => pad.getBoundingClientRect());
  const left = Math.min(...pads.map(pad => pad.left));
  const right = Math.max(...pads.map(pad => pad.right));
  const top = Math.min(...pads.map(pad => pad.top));
  const bottom = Math.max(...pads.map(pad => pad.bottom));
  return {
    offCentre: Math.abs((left + right) / 2 - window.innerWidth / 2),
    heightShare: (bottom - top) / window.innerHeight,
    // Pads of a fractional width leave thin seams between neighbours.
    wholePixelPads: pads.every(pad => Number.isInteger(pad.width) && Number.isInteger(pad.height)),
  };
});

export async function expectLandscapePads(page: Page, screen: string) {
  // A centred grid can still have its previous viewport's size until resize delivery.
  // Check every condition on the same sample, including the upper height bound.
  await expect.poll(async () => {
    const grid = await padGrid(page);
    return {
      centred: grid.offCentre <= 1,
      fillsHeight: grid.heightShare > 0.8,
      fitsHeight: grid.heightShare <= 1,
      wholePixelPads: grid.wholePixelPads,
    };
  }, screen).toEqual({ centred: true, fillsHeight: true, fitsHeight: true, wholePixelPads: true });
}
