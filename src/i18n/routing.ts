import { defineRouting } from 'next-intl/routing';

export const localeCookie = {
  name: 'NEXT_LOCALE',
  maxAge: 60 * 60 * 24 * 365,
};

export const routing = defineRouting({
  locales: ['en', 'ko'],
  defaultLocale: 'en',
  localePrefix: 'never',
  localeCookie,
});
