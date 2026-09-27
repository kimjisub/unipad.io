import { logEvent } from 'firebase/analytics';
import { initFirebaseServices } from '@/lib/firebase';

/** Sends one event to Firebase Analytics; failures never reach the caller. */
export function logAnalyticsEvent(name: string, params?: Record<string, string | number | boolean>): void {
  initFirebaseServices().then((services) => {
    if (!services?.analytics) return;
    logEvent(services.analytics, name, params);
  }).catch(() => {
    // ignore analytics failures
  });
}
