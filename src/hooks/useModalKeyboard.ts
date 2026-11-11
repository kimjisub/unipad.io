import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useWindowKeyDown } from './useWindowKeyDown';
import { isSearchShortcut } from '../components/play/keyboardShortcuts';

interface ModalEntry {
  element: HTMLElement;
  layer: HTMLElement;
  focus: () => void;
  restoreFocus?: () => void;
}

// All guarded dialogs share one order for focus, keyboard input and painting.
const openModals: ModalEntry[] = [];
const focusable = 'button:not(:disabled), [href], [tabindex="0"]';

interface ModalKeyboardOptions {
  dialogRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  onEscape: () => void;
  onEnter?: (event: KeyboardEvent, inside: boolean) => void;
}

/** Only the newest dialog may guard focus or receive keys, even across dialog types. */
export function useModalKeyboard({ dialogRef, layerRef, initialFocusRef, returnFocusRef, onEscape, onEnter }: ModalKeyboardOptions) {
  const entryRef = useRef<ModalEntry | null>(null);
  useLayoutEffect(() => {
    const element = dialogRef.current;
    const layer = layerRef.current;
    if (!element || !layer) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = openModals.at(-1);
    // A covered dialog's selected control takes priority over an explicit background opener.
    const returnFocus = active && previous?.element.contains(active) ? active : (returnFocusRef?.current ?? active);
    const originalZIndex = layer.style.zIndex;
    layer.style.zIndex = String(previous ? Number(previous.layer.style.zIndex) + 1 : 100);
    const entry: ModalEntry = { element, layer, focus: () => initialFocusRef.current?.focus({ preventScroll: true }) };
    entryRef.current = entry;
    openModals.push(entry);
    entry.focus();
    const keepFocus = (event: FocusEvent) => {
      if (openModals.at(-1) === entry && !element.contains(event.target as Node)) entry.focus();
    };
    window.addEventListener('focusin', keepFocus);
    return () => {
      window.removeEventListener('focusin', keepFocus);
      const wasTop = openModals.at(-1) === entry;
      const index = openModals.indexOf(entry);
      if (index !== -1) openModals.splice(index, 1);
      entryRef.current = null;
      layer.style.zIndex = originalZIndex;
      const uncovered = openModals.at(-1);
      entry.restoreFocus = () => {
        // A dialog mounted in the same commit already owns focus.
        if (!wasTop || openModals.at(-1) !== uncovered) return;
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        else uncovered?.focus();
      };
    };
  }, [dialogRef, layerRef, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    const entry = entryRef.current;
    // React must finish removing inert from a covered parent before it can take focus.
    return () => entry?.restoreFocus?.();
  }, [dialogRef, layerRef, initialFocusRef, returnFocusRef]);

  useWindowKeyDown(event => {
    const entry = entryRef.current;
    if (!entry || openModals.at(-1) !== entry) return;
    // Native defaults (button activation, copy, zoom, refresh) remain available.
    event.stopImmediatePropagation();
    const inside = event.target instanceof window.Node && entry.element.contains(event.target);
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
    } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const targets = Array.from(entry.element.querySelectorAll<HTMLElement>(focusable));
      const index = targets.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? targets.length - 1 : index - 1) : (index + 1) % targets.length;
      targets[next]?.focus({ preventScroll: true });
    } else if (isSearchShortcut(event)) {
      // Propagation alone does not stop Firefox quick find or native search shortcuts.
      event.preventDefault();
    } else if (event.key === 'Enter') {
      onEnter?.(event, inside);
    }
  }, { capture: true });
}
