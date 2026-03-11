import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Analytics, getAnalytics, isSupported as analyticsIsSupported } from 'firebase/analytics';
import { getPerformance } from 'firebase/performance';
import { getRemoteConfig, fetchAndActivate, RemoteConfig } from 'firebase/remote-config';
import { Database, getDatabase } from 'firebase/database';
import { Messaging, getMessaging, isSupported as messagingIsSupported } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

export interface FirebaseServices {
  app: FirebaseApp;
  analytics: Analytics | null;
  performance: ReturnType<typeof getPerformance> | null;
  remoteConfig: RemoteConfig | null;
  database: Database | null;
  messaging: Messaging | null;
}

function hasRequiredFirebaseConfig(): boolean {
  return Boolean(
    firebaseConfig.apiKey
      && firebaseConfig.authDomain
      && firebaseConfig.projectId
      && firebaseConfig.appId,
  );
}

export function getFirebaseApp(): FirebaseApp | null {
  if (!hasRequiredFirebaseConfig()) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

let analyticsInitPromise: Promise<Analytics | null> | null = null;
let servicesInitPromise: Promise<FirebaseServices | null> | null = null;

export function initFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (!analyticsInitPromise) {
    analyticsInitPromise = (async () => {
      const app = getFirebaseApp();
      if (!app) {
        return null;
      }

      const supported = await analyticsIsSupported().catch(() => false);
      if (!supported) {
        return null;
      }

      return getAnalytics(app);
    })();
  }

  return analyticsInitPromise;
}

export function initFirebaseServices(): Promise<FirebaseServices | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (!servicesInitPromise) {
    servicesInitPromise = (async () => {
      const app = getFirebaseApp();
      if (!app) {
        return null;
      }

      const analytics = await initFirebaseAnalytics();
      let performance: ReturnType<typeof getPerformance> | null = null;
      try {
        performance = getPerformance(app);
      } catch {
        performance = null;
      }

      let remoteConfig: RemoteConfig | null = null;
      try {
        remoteConfig = getRemoteConfig(app);
        remoteConfig.settings = {
          minimumFetchIntervalMillis:
            process.env.NODE_ENV === 'development' ? 0 : 60 * 60 * 1000,
          fetchTimeoutMillis: 10 * 1000,
        };
        remoteConfig.defaultConfig = {};
        await fetchAndActivate(remoteConfig).catch(() => false);
      } catch {
        remoteConfig = null;
      }

      let database: Database | null = null;
      try {
        database = getDatabase(app);
      } catch {
        database = null;
      }

      let messaging: Messaging | null = null;
      try {
        const messagingSupported = await messagingIsSupported().catch(() => false);
        if (messagingSupported) {
          messaging = getMessaging(app);
        }
      } catch {
        messaging = null;
      }

      return {
        app,
        analytics,
        performance,
        remoteConfig,
        database,
        messaging,
      };
    })();
  }

  return servicesInitPromise;
}
