import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useIsPresent } from 'framer-motion';
import { useWindowKeyDown } from './useWindowKeyDown';
import { isSearchShortcut } from '../components/play/keyboardShortcuts';

interface ModalEntry {
  element: HTMLElement;
  focus: () => void;
  /** Present when the dialog names a safe control for when a dialog over it closes. */
  focusUncovered?: () => void;
  /** Set when a dialog above closes, until a fresh key press: a key held for that dialog must not repeat here. */
  ignoreRepeats: boolean;
  restoreFocus?: () => void;
}

// All guarded dialogs share one order for focus and keyboard input.
const openModals: ModalEntry[] = [];
// Painting order also counts closing dialogs, which have left `openModals` but still fade out.
const paintedLayers = new Set<HTMLElement>();
const focusable = 'button:not(:disabled), [href], [tabindex="0"]';
const pointerEvents = ['pointerdown', 'mousedown', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const;

interface ModalKeyboardOptions {
  dialogRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  /**
   * Takes focus when a dialog over this one closes, instead of the control selected before it
   * opened. A dialog whose selected control can be destructive names a safe one, so a second press
   * meant for the dialog that just closed cannot confirm this one.
   */
  uncoveredFocusRef?: RefObject<HTMLButtonElement | null>;
  /** Chooses where focus returns when the dialog closes, over the element focused when it opened. */
  returnFocusTarget?: () => HTMLElement | null;
  /** Held Enter or Space activates the focused button once, not again with each repeat. */
  ignoreRepeatedActivation?: boolean;
  onEscape: () => void;
  onEnter?: (event: KeyboardEvent, inside: boolean) => void;
}

/**
 * Only the newest dialog may guard focus or receive keys, even across dialog types.
 *
 * Inside `AnimatePresence`, a dialog that starts to close hands focus and keys to what it covered
 * at once and leaves the accessibility tree, while its exit animation keeps it painted. Keys never
 * wait for that animation, which a busy device can hold for seconds. Until it is gone the closing
 * dialog still catches the pointer, so a click on what is still visible never lands underneath.
 */
export function useModalKeyboard({
  dialogRef, layerRef, initialFocusRef, returnFocusRef, uncoveredFocusRef, returnFocusTarget, ignoreRepeatedActivation,
  onEscape, onEnter,
}: ModalKeyboardOptions) {
  const entryRef = useRef<ModalEntry | null>(null);
  const returnFocusTargetRef = useRef(returnFocusTarget);
  useLayoutEffect(() => { returnFocusTargetRef.current = returnFocusTarget; });
  const present = useIsPresent();

  // The painting order lasts until the layer unmounts, so a closing dialog fades above what it covered.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const originalZIndex = layer.style.zIndex;
    layer.style.zIndex = String(Math.max(99, ...Array.from(paintedLayers, painted => Number(painted.style.zIndex))) + 1);
    paintedLayers.add(layer);
    return () => {
      paintedLayers.delete(layer);
      layer.style.zIndex = originalZIndex;
    };
  }, [layerRef]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (present || !layer) return;
    const contents = Array.from(layer.children).filter(child => child instanceof HTMLElement);
    // Leave focus before hiding, so assistive technology never sees focus inside a hidden layer.
    if (document.activeElement instanceof HTMLElement && layer.contains(document.activeElement)) document.activeElement.blur();
    for (const child of contents) child.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    // Inert contents let the pointer fall through to the layer itself, which keeps it from what lies beneath.
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    for (const type of pointerEvents) layer.addEventListener(type, swallow, true);
    return () => {
      for (const type of pointerEvents) layer.removeEventListener(type, swallow, true);
      for (const child of contents) child.inert = false;
      layer.removeAttribute('aria-hidden');
    };
  }, [layerRef, present]);

  useLayoutEffect(() => {
    const element = dialogRef.current;
    const layer = layerRef.current;
    if (!present || !element || !layer) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = openModals.at(-1);
    // A covered dialog's selected control takes priority over an explicit background opener.
    const returnFocus = active && previous?.element.contains(active) ? active : (returnFocusRef?.current ?? active);
    const entry: ModalEntry = {
      element,
      focus: () => initialFocusRef.current?.focus({ preventScroll: true }),
      focusUncovered: uncoveredFocusRef && (() => uncoveredFocusRef.current?.focus({ preventScroll: true })),
      ignoreRepeats: false,
    };
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
      const uncovered = openModals.at(-1);
      if (wasTop && uncovered) uncovered.ignoreRepeats = true;
      entry.restoreFocus = () => {
        // A dialog mounted in the same commit already owns focus.
        if (!wasTop || openModals.at(-1) !== uncovered) return;
        if (uncovered?.focusUncovered) {
          uncovered.focusUncovered();
          return;
        }
        const target = returnFocusTargetRef.current?.() ?? returnFocus;
        if (target?.isConnected) target.focus({ preventScroll: true });
        else uncovered?.focus();
      };
    };
  }, [dialogRef, layerRef, initialFocusRef, returnFocusRef, uncoveredFocusRef, present]);

  useEffect(() => {
    const entry = entryRef.current;
    // React must finish removing inert from a covered parent before it can take focus.
    return () => entry?.restoreFocus?.();
  }, [dialogRef, layerRef, initialFocusRef, returnFocusRef, uncoveredFocusRef, present]);

  useWindowKeyDown(event => {
    const entry = entryRef.current;
    if (!entry || openModals.at(-1) !== entry) return;
    // Native defaults (button activation, copy, zoom, refresh) remain available.
    event.stopImmediatePropagation();
    if (entry.ignoreRepeats && event.repeat) {
      event.preventDefault();
      return;
    }
    entry.ignoreRepeats = false;
    const inside = event.target instanceof window.Node && entry.element.contains(event.target);
    if (ignoreRepeatedActivation && event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    } else if (event.key === 'Escape') {
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
