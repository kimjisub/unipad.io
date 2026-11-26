import type { AutoPlayElementChain } from './types';

// Parser-only provenance keeps the public and saved element shape unchanged. Old saved arrays
// have no provenance; the mapper handles those without changing them during loading.
const origins = new WeakMap<AutoPlayElementChain, boolean>();

export function rememberChainOrigin(element: AutoPlayElementChain, fromSound: boolean): void {
  origins.set(element, fromSound);
}

export function chainOrigin(element: AutoPlayElementChain): boolean | undefined {
  return origins.get(element);
}
