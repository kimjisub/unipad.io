import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';

import '@radix-ui/themes/styles.css';
import '../../globals.css';

import Footer from '@/components/Footer';
import { Analytics } from '@vercel/analytics/next';
import { FirebaseAnalytics } from '@/components/FirebaseAnalytics';
import GrainOverlay from '@/components/GrainOverlay';
import ScrollProgressIndicator from '@/components/ScrollProgressIndicator';
import { ScrollToTop } from '@/components/ScrollToTop';
import { SkipToContent } from '@/components/SkipToContent';
import { ThemeProvider } from '@/components/ThemeProvider';
import TopBar from '@/components/TopBar';
import { AnimatePresenceWrapper } from '@/components/motion/AnimatePresenceWrapper';
import { routing } from '@/i18n/routing';

const inter = Inter({
	subsets: ['latin'],
	variable: '--font-sans',
});

const siteUrl = 'https://unipad.io';

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: {
		default: 'UniPad - Play Rhythm',
		template: '%s | UniPad',
	},
	description: 'Turn your device into a Launchpad. Play, create, and share music with 9.2M+ downloads worldwide. Free, open-source, with LED guides, auto-play, custom skins, and the UniPack ecosystem.',
	keywords: ['UniPad', 'Launchpad', 'UniPack', 'Music', 'Rhythm', 'Android', 'Web', 'MIDI', 'LED', 'Free', 'Open Source', 'Music Game', 'Pad', 'DJ'],
	authors: [{ name: 'UniPad Team', url: siteUrl }],
	creator: 'UniPad Team',
	openGraph: {
		type: 'website',
		url: siteUrl,
		siteName: 'UniPad',
		title: 'UniPad - Play Rhythm',
		description: 'Turn your device into a Launchpad. 9.2M+ downloads. Free & open-source with LED guides, custom skins, and the UniPack ecosystem.',
		images: [{ url: '/icon-192.png', width: 192, height: 192, alt: 'UniPad Logo' }],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'UniPad - Play Rhythm',
		description: 'Turn your device into a Launchpad. 9.2M+ downloads. Free & open-source with LED guides, custom skins, and the UniPack ecosystem.',
	},
	robots: {
		index: true,
		follow: true,
	},
	alternates: {
		languages: {
			en: `${siteUrl}/en`,
			ko: `${siteUrl}/ko`,
		},
	},
};

export function generateStaticParams() {
	return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
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

	return (
		<html lang={locale} className={`${inter.variable} dark`}>
			<head>
				<meta name="theme-color" content="#161e2b" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
				<link rel="manifest" href="/manifest.json" />
				<link rel="apple-touch-icon" href="/icon-192.png" />
				<link rel="dns-prefetch" href="https://fonts.googleapis.com" />
				<link rel="dns-prefetch" href="https://play.google.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
			</head>
			<body className="font-sans bg-background text-foreground antialiased">
				<NextIntlClientProvider locale={locale} messages={messages}>
					<ThemeProvider>
						<Suspense fallback={null}><FirebaseAnalytics /></Suspense>
						<Analytics />
						<SkipToContent />
						<GrainOverlay />
						<ScrollProgressIndicator />
						<div className="min-h-screen flex flex-col">
							<TopBar />
							<main id="main-content" className="flex-grow pt-14" tabIndex={-1}>
								<AnimatePresenceWrapper>
									{children}
								</AnimatePresenceWrapper>
							</main>
							<Footer />
							<ScrollToTop />
						</div>
					</ThemeProvider>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
