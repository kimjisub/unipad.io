import type { Metadata } from 'next';
import { Suspense } from 'react';
import { preload } from 'react-dom';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';

import '../../globals.css';
import { Analytics } from '@vercel/analytics/next';
import { FirebaseAnalytics } from '@/components/FirebaseAnalytics';
import { routing } from '@/i18n/routing';

// Must match the latin file declared for Inter in globals.css.
const INTER_LATIN = '/fonts/inter-latin-c9407645.woff2';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'play.meta' });

  return {
    title: t('title'),
    description: t('description'),
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function PlayLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();
  preload(INTER_LATIN, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });

  return (
    <html lang={locale} className="font-inter dark">
      <head>
        <meta name="theme-color" content="#161e2b" />
        <meta name="screen-orientation" content="landscape" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="font-sans bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={{ play: messages.play }}>
          <Suspense fallback={null}><FirebaseAnalytics /></Suspense>
          <Analytics />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
