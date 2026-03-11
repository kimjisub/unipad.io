'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { logEvent } from 'firebase/analytics';
import { initFirebaseServices } from '@/lib/firebase';

export function FirebaseAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    let detached = false;
    let cleanup: (() => void) | null = null;

    initFirebaseServices().then((services) => {
      if (detached || !services?.analytics) return;

      const analytics = services.analytics;

      const onError = (event: ErrorEvent) => {
        logEvent(analytics, 'exception', {
          description: event.message || 'window_error',
          fatal: false,
        });
      };

      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const description =
          typeof reason === 'string'
            ? reason
            : reason?.message || 'unhandled_rejection';
        logEvent(analytics, 'exception', {
          description,
          fatal: false,
        });
      };

      window.addEventListener('error', onError);
      window.addEventListener('unhandledrejection', onUnhandledRejection);

      cleanup = () => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onUnhandledRejection);
      };
    }).catch(() => {
      // ignore analytics init errors
    });

    return () => {
      detached = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    initFirebaseServices().then((services) => {
      if (!services?.analytics) return;

      const query = searchParams.toString();
      const location = query ? `${pathname}?${query}` : pathname;
      logEvent(services.analytics, 'page_view', {
        page_path: location,
      });
    }).catch(() => {
      // ignore analytics init errors
    });
  }, [pathname, searchParams]);

  return null;
}
