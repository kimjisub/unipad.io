import type { Page } from '@playwright/test';
import type { Contact } from './touch';

export type TouchInput = (type: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel', points: Contact[]) => Promise<void>;

/**
 * Supplemental application-listener coverage, NOT browser touch injection.
 * Untrusted PointerEvents bypass touch-to-pointer conversion, gesture arbitration,
 * user activation and native pointer capture. Keeping the initial target models
 * capture for moves/releases; it cannot prove that the browser captures a finger.
 * No DOM APIs, application listeners or audio calls are replaced.
 */
export async function pointerTouch(page: Page): Promise<TouchInput> {
  const state = await page.evaluateHandle(() => ({
    contacts: new Map<number, { point: Contact; target: Element }>(),
    primary: null as number | null,
  }));
  return async (type, points) => {
    await page.evaluate(({ state, type, points }) => {
      const emit = (eventType: string, point: Contact, target: Element) => {
        target.dispatchEvent(new PointerEvent(eventType, {
          bubbles: true, cancelable: true, composed: true,
          pointerId: point.id, pointerType: 'touch', isPrimary: state.primary === point.id,
          clientX: point.x, clientY: point.y,
          button: eventType === 'pointermove' ? -1 : 0,
          buttons: eventType === 'pointerup' || eventType === 'pointercancel' ? 0 : 1,
        }));
      };
      if (type === 'touchStart') {
        for (const point of points) {
          if (state.contacts.has(point.id)) continue;
          const target = document.elementFromPoint(point.x, point.y);
          if (!target) throw new Error(`No target for contact ${point.id}`);
          if (!state.contacts.size) state.primary = point.id;
          state.contacts.set(point.id, { point, target });
          emit('pointerdown', point, target);
        }
      } else if (type === 'touchMove') {
        for (const point of points) {
          const contact = state.contacts.get(point.id);
          if (!contact) throw new Error(`Moving unknown contact ${point.id}`);
          emit('pointermove', point, contact.target);
          contact.point = point;
        }
      } else {
        // Match touch.ts: a nonempty touchEnd list names contacts lifted, not survivors.
        const ids = type === 'touchCancel' || !points.length ? [...state.contacts.keys()] : points.map(point => point.id);
        for (const id of ids) {
          const contact = state.contacts.get(id);
          if (!contact) continue;
          emit(type === 'touchCancel' ? 'pointercancel' : 'pointerup', contact.point, contact.target);
          state.contacts.delete(id);
        }
        if (!state.contacts.size) state.primary = null;
      }
    }, { state, type, points });
  };
}
