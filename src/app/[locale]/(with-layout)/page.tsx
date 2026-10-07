import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';

import { CommunitySection } from '@/components/introduce/CommunitySection';
import { CtaSection } from '@/components/introduce/CtaSection';
import { FaqSection } from '@/components/introduce/FaqSection';
import { FeaturesSection } from '@/components/introduce/FeaturesSection';
import { HeroSection } from '@/components/introduce/HeroSection';
import { HowItWorksSection } from '@/components/introduce/HowItWorksSection';
import { StatsSection } from '@/components/introduce/StatsSection';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'hero' });
  const title = `UniPad — ${t('tagline')}`;
  const description = t('description');

  return {
    title,
    description,
    alternates: {
      canonical: 'https://unipad.io',
    },
    openGraph: {
      title,
      description,
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tFaq = await getTranslations('faq');
  const tHero = await getTranslations('hero');

  const faqItems = ['0', '1', '2', '3', '4', '5', '6'].map((key) => ({
    '@type': 'Question' as const,
    name: tFaq(`items.${key}.q`),
    acceptedAnswer: {
      '@type': 'Answer' as const,
      text: tFaq(`items.${key}.a`),
    },
  }));

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'UniPad',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Android, iOS, Web',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: '4.0',
        ratingCount: '100000',
      },
      description: tHero('description'),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems,
    },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HeroSection />
      <StatsSection />
      <FeaturesSection />
      <HowItWorksSection />
      <CommunitySection />
      <FaqSection />
      <CtaSection />
    </div>
  );
}
