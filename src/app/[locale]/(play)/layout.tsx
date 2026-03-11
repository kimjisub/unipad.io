import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import '../../globals.css';
import { FirebaseAnalytics } from '@/components/FirebaseAnalytics';
import { routing } from '@/i18n/routing';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'UniPad Web Player',
  description: 'Play UniPack directly in your browser with Web Audio and Web MIDI support.',
};

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

  return (
    <html lang={locale} className={`${inter.variable} dark`}>
      <head>
        <meta name="theme-color" content="#161e2b" />
      </head>
      <body className="font-sans bg-background text-foreground antialiased">
        <Suspense fallback={null}><FirebaseAnalytics /></Suspense>
        {children}
      </body>
    </html>
  );
}
