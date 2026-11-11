import { useLayoutEffect, useRef } from 'react';

interface WindowKeyDownOptions {
  /** While false, keys pass by without calling the handler; the listener itself stays attached. */
  enabled?: boolean;
  /** Listen in the capture phase, ahead of every bubbling listener on the page. */
  capture?: boolean;
}

/**
 * Listens to `keydown` on the window for as long as the component is shown.
 *
 * The listener is attached once, in the commit that first shows the component, so its place among
 * other window listeners never changes and no key arrives while it is detached. Each key is given
 * to the handler from the latest commit, so it always sees the values on screen.
 */
export function useWindowKeyDown(
  handler: (event: KeyboardEvent) => void,
  { enabled = true, capture = false }: WindowKeyDownOptions = {},
) {
  const latest = useRef({ handler, enabled });
  useLayoutEffect(() => {
    latest.current = { handler, enabled };
  });

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (latest.current.enabled) latest.current.handler(event);
    };
    window.addEventListener('keydown', onKeyDown, capture);
    return () => window.removeEventListener('keydown', onKeyDown, capture);
  }, [capture]);
}
