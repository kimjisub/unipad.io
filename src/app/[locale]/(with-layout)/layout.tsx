import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale, getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';

import '@radix-ui/themes/styles.css';
import '../../globals.css';

import Footer from '@/components/Footer';
import GrainOverlay from '@/components/GrainOverlay';
import ScrollProgressIndicator from '@/components/ScrollProgressIndicator';
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
	description: 'UniPad is a music app that lets you play Launchpad on your smartphone. Share projects with the UniPack system, and use efficient practice modes and USB connectivity.',
	keywords: ['UniPad', 'Launchpad', 'UniPack', 'Music', 'Android', 'App'],
	authors: [{ name: 'UniPad Team', url: siteUrl }],
	creator: 'UniPad Team',
	openGraph: {
		type: 'website',
		url: siteUrl,
		siteName: 'UniPad',
		title: 'UniPad - Play Rhythm',
		description: 'UniPad is a music app that lets you play Launchpad on your smartphone.',
		images: [
			{
				url: '/og-image.png',
				width: 1200,
				height: 630,
				alt: 'UniPad',
			},
		],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'UniPad - Play Rhythm',
		description: 'UniPad is a music app that lets you play Launchpad on your smartphone.',
		images: ['/og-image.png'],
	},
	robots: {
		index: true,
		follow: true,
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
			</head>
			<body className="font-sans bg-background text-foreground antialiased">
				<NextIntlClientProvider locale={locale} messages={messages}>
					<ThemeProvider>
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
						</div>
					</ThemeProvider>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
