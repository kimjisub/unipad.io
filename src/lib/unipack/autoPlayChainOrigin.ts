import type { AutoPlayElement, AutoPlayElementChain } from './types';

// Parsing keeps the conformance element shape intact. Mapping and saving carry the
// same provenance as an optional field so a restore or reload cannot erase it.
const origins = new WeakMap<AutoPlayElementChain, boolean>();

export function rememberChainOrigin(element: AutoPlayElementChain, fromSound: boolean): void {
  origins.set(element, fromSound);
}

export function chainOrigin(element: AutoPlayElementChain): boolean | undefined {
  return element.fromSound ?? origins.get(element);
}

/** Copy known parser provenance into the saved restore pair without changing its input. */
export function saveChainOrigins(elements: AutoPlayElement[]): AutoPlayElement[] {
  return elements.map(element => {
    if (element.type !== 'chain') return element;
    const fromSound = chainOrigin(element);
    return fromSound === undefined ? element : { ...element, fromSound };
  });
}
